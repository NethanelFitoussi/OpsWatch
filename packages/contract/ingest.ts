/**
 * What a forwarder sends to OpsWatch, and what OpsWatch answers (AWS push collection).
 *
 * The shape is small on purpose. A forwarder's job is to hand over records with enough envelope to say
 * where they came from; everything else — parsing, grouping, deciding whether any of it matters — happens
 * in OpsWatch, where it can be changed without redeploying a Lambda into somebody's account.
 *
 * `source` is a discriminator rather than a fixed meaning: `aws.logs` is what ships, and a metric stream
 * delivered through Firehose can be added later as a second source without reshaping the envelope, the
 * signature, the queue or the screens that read them.
 */
import { z } from 'zod';
import { epochSchema } from './primitives';

/** The sources OpsWatch can ingest. `aws.metrics` is reserved and not accepted yet. */
export const INGEST_SOURCES = ['aws.logs'] as const;
export type IngestSource = (typeof INGEST_SOURCES)[number];

/**
 * Bounds, in one place, because the forwarder and the endpoint must agree about them exactly.
 *
 * A forwarder that batches more than the endpoint accepts produces a rejection it cannot act on, so these
 * are the numbers both sides are built from.
 */
export const INGEST_LIMITS = {
  /** The largest body the endpoint reads, compressed or not. Anything larger is refused unread. */
  maxBodyBytes: 1_000_000,
  /** The largest body after decompression. A gzip bomb is refused at this line, not at an out-of-memory. */
  maxDecompressedBytes: 8_000_000,
  /** Records per request. */
  maxRecords: 1_000,
  /** One record's message. Longer is truncated by the forwarder, never by silence. */
  maxMessageChars: 32_768,
  /** How far out of step a request's timestamp may be before it is refused as a replay. */
  clockSkewMs: 5 * 60_000,
} as const;

/** One forwarded log record, as CloudWatch delivered it. */
export const ingestLogRecordSchema = z.object({
  /** CloudWatch's own per-event id, which is what makes a replayed batch a no-op rather than a duplicate. */
  eventId: z.string().min(1).max(128),
  at: epochSchema,
  message: z.string().max(INGEST_LIMITS.maxMessageChars),
  logStream: z.string().min(1).max(512),
});
export type IngestLogRecord = z.infer<typeof ingestLogRecordSchema>;

/**
 * One batch from one log group.
 *
 * `awsAccountId` and `region` are in the body **and** checked against the integration the signature
 * identified. A forwarder that has been copied into a second account cannot deliver into the first one's
 * data by saying it is there.
 */
export const ingestLogsRequestSchema = z.object({
  /**
   * **Strict, not lenient.** `lenientEnum` exists so a client reading a newer server's response keeps
   * working; this is a request arriving at a server, and the direction is the opposite. A source OpsWatch
   * does not implement must be refused, because coercing `aws.metrics` to `aws.logs` would file metrics as
   * log lines and nobody would ever see why.
   */
  source: z.enum(INGEST_SOURCES),
  /** The forwarder's own version, so an instance can tell an operator theirs is behind. */
  forwarderVersion: z.string().min(1).max(32),
  awsAccountId: z.string().regex(/^\d{12}$/),
  region: z.string().min(3).max(64),
  logGroup: z.string().min(1).max(512),
  /** When the forwarder sent it. Compared with the signed timestamp, never trusted on its own. */
  sentAt: epochSchema,
  records: z.array(ingestLogRecordSchema).min(1).max(INGEST_LIMITS.maxRecords),
});
export type IngestLogsRequest = z.infer<typeof ingestLogsRequestSchema>;

/**
 * What the endpoint answers.
 *
 * `accepted` and `duplicate` are reported separately: a forwarder retrying a batch it already delivered
 * should see that it was recognised, not a number that looks like the work happened twice.
 */
export const ingestAcceptedSchema = z.object({
  accepted: z.number().int().min(0),
  duplicate: z.number().int().min(0),
  /** What the receiving instance runs, so a forwarder can log that it is behind without OpsWatch guessing. */
  serverForwarderVersion: z.string(),
});
export type IngestAccepted = z.infer<typeof ingestAcceptedSchema>;
