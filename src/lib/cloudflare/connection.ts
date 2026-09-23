import 'server-only';
import { DecryptionError, decrypt, encrypt } from '../crypto';
import type { Db } from '../db/client';
import { env } from '../env';
import { credentialFor, deleteIntegration, listIntegrations, recordIntegrationTest, upsertIntegration } from '../store/repositories';
import { listZones, verifyToken, type CloudflareDeps, type CloudflareFailure, type Zone } from './api';

/**
 * The one Cloudflare connection an instance may have (§20, CF-1).
 *
 * The same shape as the AI provider, for the same reasons: one encrypted credential under its own
 * derivation, a projection that has no field for it, a connection test recorded as a status, and a
 * disconnect that deletes rather than flags.
 *
 * **Zones are chosen, not assumed.** A token can usually see every zone in an account; OpsWatch reads the
 * ones an operator picked. Watching all of them by default would put someone else's traffic on a page
 * nobody asked for it on, and would cost requests nobody agreed to.
 */

const NAME = 'default';
const PURPOSE = 'cloudflare' as const;

type CloudflareConfig = {
  /** Zone ids the operator selected. Empty means connected and watching nothing yet. */
  zoneIds: string[];
  /** The names, so a page can list what is selected without a network call. */
  zoneNames: Record<string, string>;
};

export type CloudflareConnectionView = {
  status: 'configured' | 'untested' | 'failed';
  lastTestedAt: number | null;
  lastError: string | null;
  zones: { id: string; name: string }[];
  hasCredential: boolean;
};

function parseConfig(config: unknown): CloudflareConfig {
  if (typeof config !== 'object' || config === null) return { zoneIds: [], zoneNames: {} };
  const { zoneIds, zoneNames } = config as Record<string, unknown>;
  return {
    zoneIds: Array.isArray(zoneIds) ? zoneIds.filter((one): one is string => typeof one === 'string') : [],
    zoneNames: typeof zoneNames === 'object' && zoneNames !== null ? (zoneNames as Record<string, string>) : {},
  };
}

const row = (db: Db) => listIntegrations(db, 'cloudflare').find((one) => one.name === NAME);

export function readCloudflareConnection(db: Db): CloudflareConnectionView | null {
  const found = row(db);
  if (found === undefined) return null;
  const config = parseConfig(found.config);
  return {
    status: found.status,
    lastTestedAt: found.lastTestedAt,
    lastError: found.lastError,
    zones: config.zoneIds.map((id) => ({ id, name: config.zoneNames[id] ?? id })),
    hasCredential: found.hasCredential,
  };
}

/** Whether Cloudflare is genuinely usable: a tested token **and** at least one zone chosen to read. */
export function cloudflareIsReady(db: Db): boolean {
  const connection = readCloudflareConnection(db);
  return connection?.status === 'configured' && connection.zones.length > 0;
}

export function saveCloudflareToken(db: Db, token: string, nowMs: number): void {
  upsertIntegration(
    db,
    { kind: 'cloudflare', name: NAME, credentialCiphertext: encrypt(token, env().OPSWATCH_SECRET, PURPOSE) },
    nowMs,
  );
}

/** The zones an operator chose to read. Replacing the selection never touches the token. */
export function saveCloudflareZones(db: Db, zones: { id: string; name: string }[], nowMs: number): void {
  const config: CloudflareConfig = {
    zoneIds: zones.map((zone) => zone.id),
    zoneNames: Object.fromEntries(zones.map((zone) => [zone.id, zone.name])),
  };
  upsertIntegration(db, { kind: 'cloudflare', name: NAME, config: config as unknown as Record<string, unknown> }, nowMs);
}

export function removeCloudflareConnection(db: Db): boolean {
  const found = row(db);
  if (found === undefined) return false;
  return deleteIntegration(db, found.id) > 0;
}

type Held = { ok: true; token: string } | { ok: false; error: CloudflareFailure };

/** The decrypted token, alive only inside one caller's frame. Nothing returns it further up. */
function heldToken(db: Db): Held {
  const found = row(db);
  if (found === undefined) return { ok: false, error: 'not_configured' };
  const ciphertext = credentialFor(db, found.id);
  if (ciphertext === null) return { ok: false, error: 'not_configured' };
  try {
    return { ok: true, token: decrypt(ciphertext, env().OPSWATCH_SECRET, PURPOSE) };
  } catch (error) {
    // Encrypted under a different `OPSWATCH_SECRET`, so it is unusable. That is what to tell the operator.
    if (error instanceof DecryptionError) return { ok: false, error: 'unauthorized' };
    throw error;
  }
}

/** §20's permission validation, recorded so the page can show connected, invalid or unavailable. */
export async function testCloudflareConnection(
  db: Db,
  nowMs: number,
  deps: CloudflareDeps = {},
): Promise<{ ok: true } | { ok: false; error: CloudflareFailure }> {
  const found = row(db);
  if (found === undefined) return { ok: false, error: 'not_configured' };
  const held = heldToken(db);
  if (!held.ok) return held;

  const result = await verifyToken(held.token, deps);
  // The code, never Cloudflare's sentence: their errors can quote the token's id.
  recordIntegrationTest(db, found.id, result.ok ? { ok: true } : { ok: false, error: result.error }, nowMs);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/** Discovery: the zones this token can see, so an operator picks rather than types an id. */
export async function discoverZones(db: Db, deps: CloudflareDeps = {}): Promise<{ ok: true; zones: Zone[] } | { ok: false; error: CloudflareFailure }> {
  const held = heldToken(db);
  if (!held.ok) return held;
  const result = await listZones(held.token, deps);
  return result.ok ? { ok: true, zones: result.data } : { ok: false, error: result.error };
}
