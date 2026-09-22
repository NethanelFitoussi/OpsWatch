/**
 * The app and the contract must agree about which list endpoints are paginated.
 *
 * This is the kind of disagreement that produces no error anywhere. If the server starts cursoring `/services` and
 * the app keeps asking for it as a bounded list, the app shows the first page and behaves as though that is all there
 * is — a services screen quietly missing half an estate, with nothing in the logs and every test still green.
 *
 * `ENDPOINT_PAGINATION` in the contract is the shared answer. The app's belief is not written down separately, which
 * would only be another thing to keep in step: it is read out of the client, where a cursored endpoint is the one
 * parsed with `pageSchema` and a bounded one with `listOf`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENDPOINT_PAGINATION } from '../contract';

const client = readFileSync(join(__dirname, '../client.ts'), 'utf8');

/**
 * How the client treats each GET list endpoint: `pageSchema` means it expects `{ items, nextCursor }` and asks for
 * more, `listOf` means it expects everything at once.
 */
function clientBelief(): Map<string, 'cursor' | 'bounded'> {
  const found = new Map<string, 'cursor' | 'bounded'>();
  for (const match of client.matchAll(/get\('(\/[a-z/-]+)',\s*(pageSchema|listOf)\(/g)) {
    found.set(match[1]!, match[2] === 'pageSchema' ? 'cursor' : 'bounded');
  }
  // `/logs/search` is a POST that starts a search and is polled; it is cursored through the same `cursor` field.
  if (/path: p\('\/logs\/search'\)/.test(client)) found.set('/logs/search', 'cursor');
  return found;
}

it('reads every list endpoint the way the contract says it answers', () => {
  const disagreements: string[] = [];
  for (const [path, belief] of clientBelief()) {
    const declared = (ENDPOINT_PAGINATION as Record<string, 'cursor' | 'bounded' | undefined>)[path];
    if (declared === undefined) continue; // A detail endpoint, or one the map does not cover.
    if (declared !== belief) disagreements.push(`${path}: contract says ${declared}, the client reads it as ${belief}`);
  }
  expect(disagreements).toEqual([]);
});

/**
 * The other half: an endpoint the contract declares must actually be reachable. A bounded endpoint that nobody calls
 * is dead weight; a cursored one that nobody calls is a screen that was never built.
 */
it('calls every list endpoint the contract declares', () => {
  const called = clientBelief();
  // Not called from a screen: sessions are managed on the web, and search is called through its own response shape.
  const notCalledHere = new Set(['/me/sessions', '/search', '/me/favorites']);
  const missing = Object.keys(ENDPOINT_PAGINATION).filter((path) => !called.has(path) && !notCalledHere.has(path));
  expect(missing).toEqual([]);
});

/** A cursored endpoint is useless without somewhere to put the cursor. */
it('passes a cursor to every endpoint it treats as cursored', () => {
  const withoutCursor: string[] = [];
  for (const [path, belief] of clientBelief()) {
    if (belief !== 'cursor' || path === '/logs/search') continue;
    const call = client.split('\n').find((line) => line.includes(`get('${path}'`) || line.includes(`'${path}', pageSchema`));
    const block = call?.includes('cursor') === true ? call : client.slice(client.indexOf(`get('${path}'`), client.indexOf(`get('${path}'`) + 400);
    if (!block.includes('cursor')) withoutCursor.push(path);
  }
  expect(withoutCursor).toEqual([]);
});
