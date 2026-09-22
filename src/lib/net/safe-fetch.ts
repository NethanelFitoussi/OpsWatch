import 'server-only';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, type Dispatcher } from 'undici';

/**
 * The one way OpsWatch makes an outbound HTTP request the operator can aim: a webhook, a synthetic target, a
 * notification endpoint, a self-hosted integration.
 *
 * A URL an operator types is attacker-influenced input as soon as one of them is careless, and the danger is not the
 * hostname but what it resolves to: the metadata service, another container, the database. Resolving the name and
 * then handing the *name* to the connector leaves a window between the two lookups in which the answer can change
 * (DNS rebinding). So the address is resolved once, checked, and then pinned: the connector is given a lookup that
 * can only ever return that one address. The Host header and the TLS server name stay the original hostname, so the
 * far end sees exactly the request it would otherwise have seen, and certificate validation is unaffected.
 *
 * Redirects are not followed by the client. Each hop is re-validated and re-pinned by this function, at most three,
 * because a redirect is just another operator-influenced URL — and the usual one-shot check misses every one of them.
 */
export const MAX_REDIRECTS = 3;

export type SsrfReason = 'bad_scheme' | 'unresolvable' | 'not_public' | 'too_many_redirects';

export class SsrfError extends Error {
  constructor(
    public readonly reason: SsrfReason,
    public readonly host: string,
  ) {
    super(`${reason}: ${host}`);
    this.name = 'SsrfError';
  }
}

type Address = { address: string; family: 4 | 6 };

export type SafeFetchDeps = {
  /** Every address a hostname resolves to, best first. */
  resolve: (hostname: string) => Promise<Address[]>;
  send: (url: string, init: RequestInit, dispatcher: Dispatcher) => Promise<Response>;
};

const IPV4_BLOCKS: [string, number][] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, and the cloud metadata service
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, and 255.255.255.255 with it
];

const toInt = (address: string) => address.split('.').reduce((total, octet) => total * 256 + Number(octet), 0);

function isPublicIpv4(address: string): boolean {
  const value = toInt(address);
  return !IPV4_BLOCKS.some(([block, bits]) => {
    const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
    return (value & mask) >>> 0 === (toInt(block) & mask) >>> 0;
  });
}

function isPublicIpv6(address: string): boolean {
  const value = address.toLowerCase().replace(/%.*$/, '');
  // An IPv4-mapped or IPv4-compatible address is an IPv4 address wearing a hat; judge the address inside it.
  const mapped = value.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicIpv4(mapped[1]);
  if (value === '::' || value === '::1') return false;
  const first = value.split(':')[0];
  const group = Number.parseInt(first === '' ? '0' : first, 16);
  if ((group & 0xfe00) === 0xfc00) return false; // fc00::/7, unique local
  if ((group & 0xffc0) === 0xfe80) return false; // fe80::/10, link-local
  if ((group & 0xff00) === 0xff00) return false; // ff00::/8, multicast
  if (value.startsWith('2001:db8:')) return false; // documentation
  if (value.startsWith('64:ff9b:')) return false; // NAT64, which crosses back into IPv4
  return true;
}

/** True only for an address that is routable on the public internet. Everything unrecognised is refused. */
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPublicIpv4(address);
  if (version === 6) return isPublicIpv6(address);
  return false;
}

export type PinnedLookup = (
  hostname: string,
  options: { all?: boolean },
  callback: (error: null, address: string | Address[], family?: number) => void,
) => void;

/**
 * A `lookup` that answers the checked address and nothing else, whatever DNS says a moment later. Node asks for an
 * array when it is selecting an address family itself, and for a single address otherwise; both answer the same one.
 */
export function pinnedLookup(pinned: Address): PinnedLookup {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [pinned]);
    else callback(null, pinned.address, pinned.family);
  };
}

/** An agent that can only ever reach the one address that was checked. */
function pinnedAgent(pinned: Address): Agent {
  return new Agent({ connect: { lookup: pinnedLookup(pinned) } });
}

async function pin(url: URL, resolve: SafeFetchDeps['resolve']): Promise<Address> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const literal = isIP(host);
  const candidates: Address[] = literal
    ? [{ address: host, family: literal as 4 | 6 }]
    : await resolve(host).catch(() => []);
  const [first] = candidates;
  if (!first) throw new SsrfError('unresolvable', host);
  if (!isPublicAddress(first.address)) throw new SsrfError('not_public', host);
  return first;
}

const DEFAULT_DEPS: SafeFetchDeps = {
  resolve: async (hostname) => {
    const results = await lookup(hostname, { all: true, verbatim: true });
    return results.map((result) => ({ address: result.address, family: result.family as 4 | 6 }));
  },
  send: (url, init, dispatcher) => fetch(url, { ...init, dispatcher } as RequestInit),
};

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export async function safeFetch(target: string, init: RequestInit = {}, deps: SafeFetchDeps = DEFAULT_DEPS): Promise<Response> {
  let url = new URL(target);
  for (let hop = 0; ; hop += 1) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new SsrfError('bad_scheme', url.protocol);
    const pinned = await pin(url, deps.resolve);
    const agent = pinnedAgent(pinned);
    let response: Response;
    try {
      response = await deps.send(url.toString(), { ...init, redirect: 'manual' }, agent);
    } finally {
      void agent.close().catch(() => undefined);
    }
    const location = response.headers.get('location');
    // A redirect carrying a body cannot be replayed, so it is handed back for the caller to decide about.
    if (!REDIRECTS.has(response.status) || location === null || init.body != null) return response;
    if (hop >= MAX_REDIRECTS) throw new SsrfError('too_many_redirects', url.hostname);
    url = new URL(location, url);
  }
}
