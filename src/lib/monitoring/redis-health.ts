import { REDIS_ENGINE_CPU_LEVELS, REDIS_MEMORY_LEVELS } from './insights';
import { evaluate, type Evaluation, type ResourceCheck } from './shared/evaluated-health';

/**
 * What OpsWatch checks about one Redis node, and — just as deliberately — what it refuses to judge.
 *
 * Judged: engine CPU and memory usage, against `REDIS_ENGINE_CPU_LEVELS` and `REDIS_MEMORY_LEVELS`, which
 * are AWS's own guidance and not a number somebody liked. Evictions are judged too, but only as a warning:
 * a cache evicting keys is doing what a full cache does, and it is a symptom worth surfacing rather than a
 * failure in itself.
 *
 * Not judged: hit rate and connection count. A cache deliberately holding only hot keys can run a low hit
 * rate correctly, and `CurrConnections` has no ceiling OpsWatch can read without the ElastiCache API.
 * Both are shown — a number without a verdict is still worth seeing, and a verdict without a basis is not.
 */

export type RedisReadings = {
  engineCpu: number | null;
  memoryPercent: number | null;
  /** Keys evicted over the window, summed. */
  evictions: number | null;
  metricsUnavailable: boolean;
};

function band(id: string, value: number | null, levels: typeof REDIS_ENGINE_CPU_LEVELS): ResourceCheck | null {
  if (value === null) return null;
  const rounded = Math.round(value);
  if (levels.critical !== undefined && value >= levels.critical.threshold) {
    return { id: `${id}.critical`, outcome: 'fail', values: { value: rounded, threshold: levels.critical.threshold } };
  }
  if (value >= levels.warning.threshold) {
    return { id: `${id}.warn`, outcome: 'warn', values: { value: rounded, threshold: levels.warning.threshold } };
  }
  return { id: `${id}.pass`, outcome: 'pass', values: { value: rounded, threshold: levels.warning.threshold } };
}

function evictions(count: number | null): ResourceCheck | null {
  if (count === null) return null;
  if (count === 0) return { id: 'redis.evictions.pass', outcome: 'pass' };
  // A full cache evicting keys is a cache doing its job. It is worth knowing and it is not an outage.
  return { id: 'redis.evictions.warn', outcome: 'warn', values: { count: Math.round(count) } };
}

export function evaluateRedisNode(readings: RedisReadings, nowMs: number): Evaluation {
  const checks = [
    band('redis.engineCpu', readings.engineCpu, REDIS_ENGINE_CPU_LEVELS),
    band('redis.memory', readings.memoryPercent, REDIS_MEMORY_LEVELS),
    evictions(readings.evictions),
  ].filter((check): check is ResourceCheck => check !== null);

  const unread: string[] = [];
  if (readings.metricsUnavailable) unread.push('redis.engineCpu');
  // The node was found *by* its engine CPU metric, so a missing one means the window holds no datapoints
  // — the node is there and OpsWatch cannot currently see what it is doing.
  else if (readings.engineCpu === null) unread.push('redis.engineCpu');

  return evaluate({ checks, unread, evaluatedAt: nowMs, nowMs });
}

/**
 * The hit rate, or null where the arithmetic would be a fiction.
 *
 * Zero requests is not a zero per cent hit rate: it is a cache nobody asked anything of, and rendering
 * that as 0 % would put a number that looks like a catastrophe on an idle node (§2.4).
 */
export function hitRate(hits: number | null, misses: number | null): number | null {
  if (hits === null || misses === null) return null;
  const total = hits + misses;
  return total === 0 ? null : (hits / total) * 100;
}
