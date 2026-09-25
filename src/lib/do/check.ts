import 'server-only';
import { listDroplets } from './droplets';
import type { DoTestResult } from './result';

/**
 * What this token can actually read, asked of DigitalOcean rather than assumed.
 *
 * One call, and it is the call the product makes anyway — reading the droplets. Testing with something
 * cheaper would prove a different thing: a token with `api:read` on an account whose droplets are all
 * in a team the token cannot see would pass a "does this token work" check and show nothing.
 *
 * **A count, never the droplets.** The result is written into the connection row, and a row that held
 * an account's inventory would be a copy of somebody's estate kept for no reason.
 */
export async function testDoConnection(input: { token: string | null; nowMs: number; fetchImpl?: typeof fetch }): Promise<DoTestResult> {
  const result = await listDroplets({ token: input.token, fetchImpl: input.fetchImpl });
  return result.ok
    ? { testedAt: input.nowMs, failure: null, droplets: result.data.length }
    : // Not zero: how many there are is unknown when the read failed, and zero would be a claim.
      { testedAt: input.nowMs, failure: result.reason, droplets: null };
}

/** The scope this asks for, named once so a page can show it before asking for anything. */
export const DO_SCOPE = 'droplet:read';
