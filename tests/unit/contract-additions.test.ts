import { describe, expect, it } from 'vitest';
import {
  TRENDS,
  alertSummarySchema,
  changeSchema,
  commitSchema,
  errorDetailSchema,
  errorSummarySchema,
  familySchema,
  investigationSchema,
  logEntrySchema,
  problemSummarySchema,
  repositoryEvidenceSchema,
} from '@opswatch/contract';

/**
 * The ten fields added for the Mobile agent on 2026-09-20
 * (docs/superpowers/specs/2026-09-20-contract-addendum.md).
 *
 * The guarantee every one of them has to keep is the same: **a client written against the older shape still
 * parses.** §33.1 permits additive optional fields and nothing else, so each case here builds a payload with
 * none of the new fields and asserts it is still valid.
 */
const alert = { id: 'a1', name: 'CPU', severity: 'critical', status: 'resolved', source: 'cloudwatch', since: 1 };
const error = { id: 'e1', message: 'boom', status: 'regression', firstSeenAt: 1, lastSeenAt: 2 };
const change = { id: 'c1', direction: 'up', text: 'more 5xx' };
const family = { family: 'cloudfront', label: 'CDN', status: 'unknown', total: null, affected: null };
const commit = { sha: 'abc123' };
const evidence = { id: 'r1', repository: 'checkout', commit };
const investigation = { id: 'i1', title: 'why', subject: { type: 'problem', id: 'p1' }, status: 'concluded', startedAt: 1, timeline: [] };
const logEntry = { id: 'l1', timestamp: 1, level: 'error', message: 'boom' };

describe('every addition is optional, so an older client is unaffected', () => {
  it.each([
    ['alertSummary', alertSummarySchema, alert],
    ['errorSummary', errorSummarySchema, error],
    ['change', changeSchema, change],
    ['family', familySchema, family],
    ['commit', commitSchema, commit],
    ['repositoryEvidence', repositoryEvidenceSchema, evidence],
    ['investigation', investigationSchema, investigation],
    ['logEntry', logEntrySchema, logEntry],
  ])('%s parses without any of the new fields', (_name, schema, payload) => {
    expect(schema.safeParse(payload).success).toBe(true);
  });
});

describe('what each addition answers', () => {
  it('lets a resolved alert say how long it fired, and defaults to null rather than 0', () => {
    expect(alertSummarySchema.parse(alert).resolvedAt).toBeNull();
    expect(alertSummarySchema.parse({ ...alert, resolvedAt: 5_000 }).resolvedAt).toBe(5_000);
  });

  it('lets an unreadable family say why, twice, without losing the codes logic uses', () => {
    const parsed = familySchema.parse({
      ...family,
      unavailable: {
        reason: 'denied',
        code: 'AccessDenied',
        messageKey: 'Health.unavailable.denied',
        values: { action: 'cloudfront:ListDistributions' },
        message: 'The IAM role cannot list CloudFront distributions.',
      },
    });
    // §12.2: the key for a client with the catalogue, the sentence for one without, and the codes for logic.
    expect(parsed.unavailable?.messageKey).toBe('Health.unavailable.denied');
    expect(parsed.unavailable?.message).toContain('CloudFront');
    expect({ reason: parsed.unavailable?.reason, code: parsed.unavailable?.code }).toEqual({
      reason: 'denied',
      code: 'AccessDenied',
    });
  });

  it('separates when a group came back from when it was first ever seen', () => {
    const parsed = errorSummarySchema.parse({ ...error, firstSeenAt: 1_000, statusSince: 9_000 });
    expect(parsed.firstSeenAt).toBe(1_000);
    expect(parsed.statusSince).toBe(9_000);
  });

  it('gives an error group the same trend enum a problem has, with the same null meaning', () => {
    expect(errorSummarySchema.parse(error).trend).toBeNull();
    expect(problemSummarySchema.shape.trend).toBeDefined();
    for (const trend of TRENDS) {
      expect(errorSummarySchema.parse({ ...error, trend }).trend).toBe(trend);
    }
    // A newer server's unknown value degrades rather than rejecting the whole response.
    expect(errorSummarySchema.parse({ ...error, trend: 'plummeting' }).trend).toBe('stable');
  });

  it('says whether a count is lifetime or windowed, and never leaves it ambiguous', () => {
    // null is the explicit statement "lifetime, since firstSeenAt" — not an absence of information.
    expect(errorSummarySchema.parse({ ...error, occurrences: 2_417 }).occurrencesWindow).toBeNull();
    const windowed = errorSummarySchema.parse({ ...error, occurrences: 12, occurrencesWindow: { from: 1, to: 2 } });
    expect(windowed.occurrencesWindow).toEqual({ from: 1, to: 2 });
  });

  it('gives an error group its own deployment and repository evidence', () => {
    // A stack trace lives on the error group; an error with no problemId would otherwise reach neither.
    const parsed = errorDetailSchema.parse({ ...error, repository: [evidence] });
    expect(parsed.deployments).toEqual([]);
    expect(parsed.repository[0].repository).toBe('checkout');
  });

  it('lets a brief be ordered in time, not only grouped', () => {
    expect(changeSchema.parse({ ...change, at: 7 }).at).toBe(7);
  });

  it('lets a concluded investigation say when it ended', () => {
    expect(investigationSchema.parse({ ...investigation, concludedAt: 42 }).concludedAt).toBe(42);
  });

  it('carries a permalink the server built, for the commit and for the file', () => {
    const parsed = repositoryEvidenceSchema.parse({
      ...evidence,
      commit: { sha: 'abc123', url: 'https://example.invalid/c/abc123' },
      fileUrl: 'https://example.invalid/f/charge.ts#L184',
    });
    expect(parsed.commit.url).toContain('abc123');
    expect(parsed.fileUrl).toContain('L184');
  });

  it('lets a log line reach a deployment and an incident, not only an error', () => {
    const parsed = logEntrySchema.parse({ ...logEntry, links: { deploymentId: 'd1', incidentId: 'i1' } });
    expect(parsed.links).toEqual({ deploymentId: 'd1', incidentId: 'i1' });
  });
});
