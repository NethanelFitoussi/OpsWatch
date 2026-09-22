/**
 * The deep-link allow-list. Every external entry point (URL scheme, universal link, notification tap, AI citation)
 * goes through `routeForRef` or `parseDeepLink`, so nothing outside these patterns can steer navigation.
 */
import type { Ref, RefType } from '@/api/contract';

export const ID_PATTERN = /^[A-Za-z0-9._:~-]{1,200}$/;

export function isSafeId(value: unknown): value is string {
  // `.` and `..` match the pattern but are path traversal once a URL parser normalises them, so they are refused.
  return typeof value === 'string' && ID_PATTERN.test(value) && !/^\.+$/.test(value);
}

/** In-app route of each linkable object type. `null` types are not reachable by link. */
const ROUTES: Record<RefType, string | null> = {
  problem: '/problems',
  error: '/errors',
  service: '/services',
  alert: '/alerts',
  incident: '/incidents',
  synthetic: '/synthetics',
  slo: '/slos',
  deployment: '/deployments',
  infrastructure: '/infrastructure',
  investigation: '/investigations',
  evidence: '/evidence',
  log: null,
  environment: null,
};

/** Segments accepted in external links, mapped to object types. Plural as in the in-app routes. */
const SEGMENT_TYPES: Record<string, RefType> = Object.fromEntries(
  Object.entries(ROUTES)
    .filter((entry): entry is [RefType, string] => entry[1] !== null)
    .map(([type, route]) => [route.slice(1), type]),
);

export function routeForRef(ref: Pick<Ref, 'type' | 'id'>): string | null {
  const base = ROUTES[ref.type];
  if (!base || !isSafeId(ref.id)) return null;
  return `${base}/${encodeURIComponent(ref.id)}`;
}

/** Top-level screens reachable by link without an id. */
const STATIC_PATHS = new Set(['/', '/problems', '/alerts', '/services', '/errors', '/incidents', '/synthetics', '/slos', '/deployments', '/logs', '/infrastructure', '/brief', '/search', '/ask', '/settings', '/system']);

/**
 * Parses an incoming link into an in-app path, or null when it is not allowed.
 * Accepts `opswatch://problems/abc`, `opswatch:///problems/abc`, `https://<associated domain>/m/problems/abc`, and
 * already-internal paths such as `/problems/abc`. Query strings and fragments are dropped: no link can pre-fill an
 * action or carry a token.
 */
export function parseDeepLink(input: string, options: { associatedDomain?: string } = {}): string | null {
  let path: string;
  if (input.startsWith('/')) {
    path = input;
  } else {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      return null;
    }
    if (url.protocol === 'opswatch:') {
      // `opswatch://problems/abc` parses with host `problems`; `opswatch:///problems/abc` with an empty host.
      path = `/${url.host}${url.pathname}`.replace(/\/{2,}/g, '/');
    } else if (url.protocol === 'https:' && options.associatedDomain && url.hostname === options.associatedDomain && url.pathname.startsWith('/m/')) {
      path = url.pathname.slice(2);
    } else {
      return null;
    }
  }

  path = path.split(/[?#]/)[0] ?? '';
  const normalized = path.length > 1 ? path.replace(/\/+$/, '') : path;
  if (STATIC_PATHS.has(normalized)) return normalized;

  const segments = normalized.split('/').filter(Boolean);
  if (segments.length !== 2) return null;
  const [segment, rawId] = segments as [string, string];
  const type = SEGMENT_TYPES[segment];
  if (!type) return null;
  let id: string;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    return null;
  }
  return routeForRef({ type, id });
}
