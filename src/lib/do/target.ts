import 'server-only';
import { readDoToken } from '../connections/repository';
import type { ConnectionRow } from '../db/schema';
import { env } from '../env';
import type { MonitoringResult } from '../monitoring/result';

/**
 * What a DigitalOcean read needs: the account's personal access token, decrypted.
 *
 * There is no region in it. DigitalOcean's API is account-wide — `/v2/droplets` answers for every
 * region at once and each droplet says which region it is in — so a target scoped to a region would
 * be a scope this provider does not have. Where the caller has one, it belongs in the filtering of
 * the answer, not in the request.
 */

const ACTION = 'do:token';

export type DoTarget = { provider: 'do'; connectionId: string; token: string };

export function doTargetFrom(row: ConnectionRow, secret?: string): MonitoringResult<DoTarget> {
  if (row.provider !== 'do') return { ok: false, reason: 'error', code: 'ConnectionNotFound', action: ACTION };
  // `readDoToken` answers null both for a connection that has no token yet and for one whose token
  // will not decrypt. It is worth telling those apart — one is unfinished setup, the other a changed
  // OPSWATCH_SECRET — so the ciphertext is checked first.
  if (row.doTokenCiphertext === null) return { ok: false, reason: 'error', code: 'NotReady', action: ACTION };
  const token = readDoToken(row, secret ?? env().OPSWATCH_SECRET);
  if (token === null || token === '') return { ok: false, reason: 'error', code: 'SecretChanged', action: ACTION };
  return { ok: true, data: { provider: 'do', connectionId: row.id, token } };
}
