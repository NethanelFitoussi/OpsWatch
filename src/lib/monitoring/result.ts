import 'server-only';
import { awsErrorCode, isDeniedErrorCode, normalizeAwsErrorCode } from '../aws/errors';

export type FailureReason = 'denied' | 'throttled' | 'error';
export type MonitoringFailure = { ok: false; reason: FailureReason; code: string; action: string };
export type MonitoringResult<T> = { ok: true; data: T } | MonitoringFailure;

const THROTTLED = new Set([
  'Throttling',
  'ThrottlingException',
  'TooManyRequestsException',
  'RequestLimitExceeded',
  'LimitExceededException',
  'RequestThrottled',
  'RequestThrottledException',
]);

export function toFailure(action: string, error: unknown): MonitoringFailure {
  const code = normalizeAwsErrorCode(awsErrorCode(error));
  const reason: FailureReason = isDeniedErrorCode(code) ? 'denied' : THROTTLED.has(code) ? 'throttled' : 'error';
  return { ok: false, reason, code, action };
}

export async function attempt<T>(action: string, run: () => Promise<T>): Promise<MonitoringResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    return toFailure(action, error);
  }
}

export function isFailure(value: unknown): value is MonitoringFailure {
  return typeof value === 'object' && value !== null && 'ok' in value && value.ok === false;
}
