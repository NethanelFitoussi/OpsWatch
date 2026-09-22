import 'server-only';

/**
 * Where OpsWatch keeps history, and what any implementation must promise (**§33.10**).
 *
 * This interface is deliberately more than a list of method names. The reason is §33.2's split: history is
 * optional and pluggable, so an operator may point it at something other than the OpsWatch database — and a
 * detector reading from that store must be able to trust what it gets back, whatever is behind it. An
 * eventually-consistent backend that returned half a cycle would let the engine open a problem that never
 * happened.
 *
 * So the five guarantees below are testable, and `tests/helpers/history-conformance.ts` tests them against
 * every provider including the default one. A provider that cannot pass it is not shipped.
 */

/** What a point is about. Categories are open: a later phase adds its own without changing this file. */
export type HistoryCategory = 'metric' | 'slo' | 'error_rate' | 'log_volume';

/** The resolutions §9.2 rolls up at. A provider stores each separately; it never derives one from another. */
export const RESOLUTIONS = ['5m', '1h', '1d'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

export const RESOLUTION_MS: Record<Resolution, number> = {
  '5m': 5 * 60_000,
  '1h': 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

/**
 * One stored point. The identity is `(category, subjectId, intervalStart, resolution)` — the idempotency key
 * — and writing the same key twice must leave the same state.
 */
export type HistoryPoint = {
  category: HistoryCategory;
  /** What it measures: a service id, an instance id, an error fingerprint. */
  subjectId: string;
  /** Which series, within that subject: `cpu`, `memory`, `p95`. */
  metric: string;
  connectionId: string;
  scope: string;
  /** The start of the interval, aligned to the resolution. */
  intervalStart: number;
  resolution: Resolution;
  /** `null` is "not measured" and is stored as such; it is never written as 0 (§2.4). */
  value: number | null;
  /** How many samples went into it, so a thin interval can be told from a full one. */
  samples: number;
};

export type HistoryQuery = {
  category: HistoryCategory;
  subjectId: string;
  metric: string;
  connectionId: string;
  scope: string;
  resolution: Resolution;
  from: number;
  to: number;
};

/**
 * What a read answers. The watermark is the point of it: everything at or below it is complete, and a caller
 * that respects it can never act on a half-written interval.
 */
export type HistoryResult = {
  points: HistoryPoint[];
  /**
   * The instant up to which this series is complete. Points after it may exist and may still be filling, so
   * a detector must ignore them.
   */
  watermark: number;
  /** True when the range asked for extends past the watermark, so the answer is knowingly partial. */
  partial: boolean;
};

/** A write that was refused, and why. Refusing is the point: a bad timestamp is never quietly stored. */
export class HistoryRejected extends Error {
  constructor(
    public readonly reason: 'clock_skew' | 'misaligned' | 'unknown_resolution',
    message: string,
  ) {
    super(message);
    this.name = 'HistoryRejected';
  }
}

/**
 * How far a writer's clock may be wrong before its points are refused rather than stored.
 *
 * Both directions matter. A clock ahead would create intervals that have not happened, which a watermark
 * would then have to pretend were complete; a clock far behind would rewrite history readers have acted on.
 */
export const MAX_CLOCK_SKEW_MS = 10 * 60_000;

export type HistoricalStorageProvider = {
  /** A stable name, shown in System status so an operator knows what is actually storing their history. */
  readonly id: string;

  /**
   * Writes a batch. **Idempotent** on the key, and **all-or-nothing** to readers: a reader either sees every
   * point of this batch or none of them, so a crash mid-batch is recovered by replaying it.
   *
   * Throws `HistoryRejected` rather than storing anything when a point's timestamp is outside the skew or is
   * not aligned to its resolution.
   */
  write(points: readonly HistoryPoint[], nowMs: number): Promise<void>;

  /** Reads a range, always with the watermark, and always saying when the answer is partial. */
  read(query: HistoryQuery): Promise<HistoryResult>;

  /** The instant up to which a series is complete, without reading the series itself. */
  watermark(query: Omit<HistoryQuery, 'from' | 'to'>): Promise<number>;

  /** Removes everything older than `beforeMs`, answering how many points went. */
  purge(beforeMs: number): Promise<number>;
};

/** An interval must start exactly on its resolution, or two writers would disagree about which bucket it is. */
export function isAligned(intervalStart: number, resolution: Resolution): boolean {
  return intervalStart % RESOLUTION_MS[resolution] === 0;
}

/**
 * The validation every provider owes its caller, in one place so no two providers disagree about what is
 * acceptable. A provider calls this before writing anything, and writes nothing if it throws.
 */
export function validateBatch(points: readonly HistoryPoint[], nowMs: number): void {
  for (const point of points) {
    if (!(point.resolution in RESOLUTION_MS)) {
      throw new HistoryRejected('unknown_resolution', `unknown resolution: ${point.resolution}`);
    }
    if (!isAligned(point.intervalStart, point.resolution)) {
      throw new HistoryRejected('misaligned', `interval is not aligned to ${point.resolution}`);
    }
    if (point.intervalStart - nowMs > MAX_CLOCK_SKEW_MS) {
      throw new HistoryRejected('clock_skew', 'interval starts in the future beyond the permitted skew');
    }
  }
}

/** The idempotency key of §33.10, written once so every provider keys on exactly the same thing. */
export function pointKey(point: HistoryPoint): string {
  return [
    point.category,
    point.connectionId,
    point.scope,
    point.subjectId,
    point.metric,
    point.resolution,
    point.intervalStart,
  ].join('\u0000');
}
