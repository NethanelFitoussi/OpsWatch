import { describe, expect, it, vi } from 'vitest';
import { GCP_SEVERITIES, LOG_PAGE_SIZE, logFilter, recentLogEntries } from '@/lib/gcp/logs';
import { GCP_OPTIONAL_ROLES, GCP_ROLES } from '@/lib/gcp/check';
import { GCP_REQUIRED_CHECKS, gcpStatusOf } from '@/lib/gcp/result';
import { generateConnectionKey } from '@/lib/gcp/issuer';
import type { GcpTarget } from '@/lib/gcp/target';

/**
 * Reading a Google project's logs.
 *
 * **The only part of a Google connection that reads content rather than figures**, which is why it is
 * the only part behind a role of its own. Everything else OpsWatch reads from Google is a count, a
 * status or a number; a log line is whatever somebody's code wrote, and it may contain anything at all.
 *
 * Two things this file exists to hold. **No operator text reaches the query** — Google's query
 * language can address any field of any log, so a free-text box wired into it is a way to ask a
 * project questions OpsWatch never meant to offer. And **declining the role is not a broken
 * connection**, because a status that goes yellow for a deliberate choice teaches an operator to
 * ignore the colour.
 */

const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);
const target: GcpTarget = {
  provider: 'gcp',
  connectionId: 'c1',
  projectId: 'my-project',
  region: null,
  federation: { projectNumber: '123456789012', poolId: 'opswatch', providerId: 'opswatch', serviceAccount: null },
  key: generateConnectionKey(),
  baseUrl: 'https://opswatch.example',
};

const sts = () => new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 });

function logging(entries: unknown[], status = 200) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const call = vi.fn(async (url: string, init?: { body?: string }) => {
    if (url.startsWith('https://sts.')) return sts();
    calls.push({ url, body: JSON.parse(init?.body ?? '{}') as Record<string, unknown> });
    if (status !== 200) return new Response('{}', { status });
    return new Response(JSON.stringify({ entries }), { status: 200 });
  });
  return { call, calls };
}

const read = (call: ReturnType<typeof vi.fn>, minSeverity: Parameters<typeof logFilter>[0] = 'WARNING') =>
  recentLogEntries({ target, minSeverity, nowMs: NOW, fetchImpl: call as unknown as typeof fetch });

describe('the role it needs', () => {
  it('THE RULING: declining the optional role is not a degraded connection', () => {
    /*
     * `logging` is granted separately and may be refused for good reasons. Counted in the verdict, a
     * perfectly working project would show as degraded for declining something optional — and a
     * status that goes yellow for a deliberate choice trains an operator to ignore the colour on the
     * one screen where it has to mean something.
     */
    const checks = [
      { check: 'compute' as const, status: 'ok' as const },
      { check: 'monitoring' as const, status: 'ok' as const },
      { check: 'logging' as const, status: 'denied' as const },
    ];
    expect(gcpStatusOf(checks)).toBe('ok');
    // One required role missing is degraded, which is the case this must still catch.
    expect(gcpStatusOf([{ check: 'compute', status: 'ok' }, { check: 'monitoring', status: 'denied' }])).toBe('degraded');
    // Neither required role is a connection that authenticated and can read nothing.
    expect(gcpStatusOf([{ check: 'compute', status: 'denied' }, { check: 'monitoring', status: 'denied' }])).toBe('failed');
    // And the required set does not quietly grow to include the optional one.
    expect([...GCP_REQUIRED_CHECKS]).toEqual(['compute', 'monitoring']);
  });

  it('THE RULING: it asks for the narrow role, not the one that reads who looked at what', () => {
    /*
     * `roles/logging.privateLogViewer` would also return Data Access logs — the record of which
     * person read which record. "What was my application saying" does not require that, and asking
     * for it because it is one role instead of two would be taking an audit trail of people by
     * accident.
     */
    expect([...GCP_OPTIONAL_ROLES]).toEqual(['roles/logging.viewer']);
    expect(GCP_OPTIONAL_ROLES.join()).not.toContain('privateLogViewer');
    // And the two required roles are unchanged: this one is beside them, not among them.
    expect([...GCP_ROLES]).toEqual(['roles/compute.viewer', 'roles/monitoring.viewer']);
  });
});

describe('the query it builds', () => {
  it('THE RULING: a severity it does not recognise falls back rather than reaching Google', () => {
    // The filter is a query language. A value that is not one of Google's own enum names is refused
    // here rather than concatenated in and sent.
    const hostile = 'WARNING" OR severity >= "DEFAULT' as never;
    const filter = logFilter(hostile, NOW - 60_000, NOW);
    expect(filter).not.toContain('OR');
    expect(filter).toContain('severity >= "WARNING"');
  });

  it('bounds every query by a window, so none can ask for a project’s history', () => {
    const filter = logFilter('ERROR', NOW - 3_600_000, NOW);
    expect(filter).toContain('timestamp >= "2026-09-28T11:00:00Z"');
    expect(filter).toContain('timestamp <= "2026-09-28T12:00:00Z"');
    // Upper case, because Google's query grammar requires it.
    expect(filter.split(' AND ')).toHaveLength(3);
  });

  it('posts a body to the project, newest first and one page', async () => {
    const { call, calls } = logging([]);
    await read(call);
    expect(calls[0].url).toBe('https://logging.googleapis.com/v2/entries:list');
    expect(calls[0].body.resourceNames).toEqual(['projects/my-project']);
    expect(calls[0].body.orderBy).toBe('timestamp desc');
    expect(calls[0].body.pageSize).toBe(LOG_PAGE_SIZE);
  });

  it('offers only severities Google defines', () => {
    expect([...GCP_SEVERITIES]).toContain('EMERGENCY');
    expect([...GCP_SEVERITIES]).toContain('DEFAULT');
  });
});

describe('what comes back', () => {
  it('keeps Google’s own severity rather than remapping it onto OpsWatch’s three', async () => {
    const { call } = logging([
      { insertId: 'a', timestamp: '2026-09-28T11:59:00Z', severity: 'EMERGENCY', logName: 'projects/p/logs/stdout', textPayload: 'boom' },
      { insertId: 'b', timestamp: '2026-09-28T11:58:00Z', logName: 'projects/p/logs/stdout', textPayload: 'quiet' },
    ]);
    const result = await read(call);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries[0].severity).toBe('EMERGENCY');
    // An entry with no severity is `DEFAULT` in Google's vocabulary, not "info" in ours.
    expect(result.entries[1].severity).toBe('DEFAULT');
  });

  it('finds the line whichever of the three payload shapes carried it', async () => {
    const { call } = logging([
      { insertId: 'a', timestamp: '2026-09-28T11:59:00Z', textPayload: 'plain' },
      { insertId: 'b', timestamp: '2026-09-28T11:58:00Z', jsonPayload: { message: 'structured' } },
      { insertId: 'c', timestamp: '2026-09-28T11:57:00Z', jsonPayload: { code: 500 } },
    ]);
    const result = await read(call);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries.map((entry) => entry.text)).toEqual(['plain', 'structured', '{"code":500}']);
  });

  it('truncates one enormous entry rather than letting it become the page', async () => {
    const { call } = logging([{ insertId: 'a', timestamp: '2026-09-28T11:59:00Z', textPayload: 'x'.repeat(50_000) }]);
    const result = await read(call);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries[0].text.length).toBeLessThanOrEqual(2_000);
  });

  it('says which refusal it was, and never an empty log', async () => {
    // An empty list here would read as a quiet project, which is the opposite of "you may not look".
    for (const [status, reason] of [
      [401, 'denied'],
      [403, 'denied'],
      [500, 'error'],
    ] as const) {
      const { call } = logging([], status);
      await expect(read(call), String(status)).resolves.toMatchObject({ ok: false, reason });
    }
  });
});
