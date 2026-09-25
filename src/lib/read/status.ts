import 'server-only';
import type { Db } from '../db/client';
import { lastRunFor } from '../store/collector';
import type { CollectorRunRow } from '../db/schema';

/**
 * What the collector has done, for the surfaces that must tell "nothing is wrong" from "nobody has looked".
 *
 * §T of the product-hardening mission and §21 both turn on that distinction: an instance whose first cycle
 * has not run yet has no problems *and* no knowledge, and showing it a confident "nothing is wrong" would be
 * the most damaging thing a monitoring tool can say.
 */
export function lastRunOf(db: Db, job: string, scope: { connectionId: string; scope: string }): CollectorRunRow | null {
  // Asked of the database rather than filtered out of the recent rows: with several AWS connections the
  // recent rows no longer reach back an hour, and an hourly job then read as never having run at all.
  return lastRunFor(db, job, scope);
}
