import 'server-only';
import type { AwsCredentialIdentity } from '@smithy/types';
import { AWS_CALL_TIMEOUT_MS } from '../aws/timeout';
import { logMonitoringFailure, type MonitoringEvent } from '../log';
import { DESCRIBE_TTL_MS, cacheKey, cached, monitoringCache, type TtlCache } from './cache';
import { attempt, type MonitoringResult } from './result';

export type MonitoringScope = { connectionId: string; region: string };
/** Scope plus resolved credentials. Server-side only: never pass it to a client component. */
export type AwsTarget = MonitoringScope & { credentials: AwsCredentialIdentity };
export type MonitoringDeps = { cache?: TtlCache; timeoutMs?: number; log?: (event: MonitoringEvent) => void };

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function describeTimeout(deps: MonitoringDeps): number {
  return deps.timeoutMs ?? AWS_CALL_TIMEOUT_MS;
}

export async function runCall<T>(scope: MonitoringScope, action: string, run: () => Promise<T>, deps: MonitoringDeps = {}): Promise<MonitoringResult<T>> {
  const result = await attempt(action, run);
  if (!result.ok) {
    (deps.log ?? logMonitoringFailure)({ event: 'monitoring_call', connectionId: scope.connectionId, region: scope.region, action, reason: result.reason, code: result.code });
  }
  return result;
}

/** A cached describe/list call: one AWS action, 60 s TTL by default. */
export function describeCall<T>(
  target: AwsTarget,
  action: string,
  params: unknown,
  run: () => Promise<T>,
  deps: MonitoringDeps = {},
  ttlMs: number = DESCRIBE_TTL_MS,
): Promise<MonitoringResult<T>> {
  return cached(deps.cache ?? monitoringCache, cacheKey(target, action, params), ttlMs, () => runCall(target, action, run, deps));
}
