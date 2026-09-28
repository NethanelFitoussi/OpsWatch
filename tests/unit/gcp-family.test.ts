import { describe, expect, it, vi } from 'vitest';
import { gcpAlertsFamily, incidentSubjectId, severityOf } from '@/lib/gcp/family';
import { generateConnectionKey } from '@/lib/gcp/issuer';
import type { GcpTarget } from '@/lib/gcp/target';
import { outcomesFromInsights } from '@/lib/detect/aws';
import { familyOfKind } from '@/lib/detect/family';

/**
 * Google's incidents, becoming OpsWatch problems.
 *
 * The decision underneath this file: **OpsWatch does not evaluate Google's metrics.** The project's
 * own alerting policies do that, an operator wrote them, and relaying what they opened is using the
 * provider's evidence. A parallel set of OpsWatch thresholds would be a second opinion beside the one
 * the project already has, and the two would disagree in front of somebody at three in the morning.
 *
 * So there is one Google kind rather than four families mirroring AWS's with Google names on them.
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

const alert = (over: Record<string, unknown> = {}) => ({
  name: 'projects/my-project/alerts/0.one',
  state: 'OPEN',
  openTime: '2026-09-28T11:00:00Z',
  resource: { type: 'gce_instance', labels: { instance_name: 'web-1' } },
  policy: { displayName: 'CPU above 90%', severity: 'CRITICAL' },
  ...over,
});

function google(alerts: unknown[], policies: unknown[], status = 200) {
  return vi.fn(async (url: string) => {
    if (url.startsWith('https://sts.')) return sts();
    if (status !== 200) return new Response('{}', { status });
    return new Response(JSON.stringify(url.includes('/alertPolicies') ? { alertPolicies: policies } : { alerts }), { status: 200 });
  });
}

const load = (call: ReturnType<typeof vi.fn>) => gcpAlertsFamily(target, NOW, { fetchImpl: call as unknown as typeof fetch });

describe('Google’s severity, in OpsWatch’s three', () => {
  it('THE RULING: an incident Google opened is never merely information', () => {
    // Google opening an incident is a statement that something is wrong. `info` would read as a
    // remark, and a policy whose author set no severity has not said "this is minor".
    expect(severityOf(null)).toBe('warning');
    expect(severityOf('SEVERITY_UNSPECIFIED')).toBe('warning');
    expect(severityOf('WARNING')).toBe('warning');
    // Google's alerting is opt-in: somebody chose ERROR to mean a failure, and ranking it below that
    // would put OpsWatch's opinion above the policy author's.
    expect(severityOf('ERROR')).toBe('critical');
    expect(severityOf('CRITICAL')).toBe('critical');
  });

  it('keeps Google’s own word beside the mapping, so nothing it loses is hidden', async () => {
    const result = await load(google([alert({ policy: { displayName: 'Latency', severity: 'ERROR' } })], [{ enabled: true }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.insights[0].severity).toBe('critical');
    // Three Google ranks became two OpsWatch ones; the operator still sees which of the three it was.
    expect(result.data.insights[0].values.severity).toBe('ERROR');
  });
});

describe('what makes two incidents two problems', () => {
  it('THE RULING: the policy and the resource together, because either alone is wrong', () => {
    /*
     * Two policies watching one instance are two problems, and one policy firing on two instances is
     * two problems. Keyed on the resource alone, the first pair would collapse into one row whose
     * title flipped between them; keyed on the policy alone, the second would.
     */
    const base = { id: 'x', policy: 'CPU', severity: null, openedAt: NOW, resourceType: 'gce_instance', resourceName: 'web-1' };
    const otherPolicy = incidentSubjectId({ ...base, policy: 'Memory' });
    const otherResource = incidentSubjectId({ ...base, resourceName: 'web-2' });
    expect(incidentSubjectId(base)).not.toBe(otherPolicy);
    expect(incidentSubjectId(base)).not.toBe(otherResource);
    // And the same incident, read again next cycle, is the same problem.
    expect(incidentSubjectId({ ...base, id: 'different-id', openedAt: NOW + 60_000 })).toBe(incidentSubjectId(base));
  });

  it('cannot be made to collide by a separator inside a policy name', () => {
    // Length-prefixed, for the reason the dedupe key is: `"a|b" on ""` and `"a" on "b"` are different.
    const a = incidentSubjectId({ id: '1', policy: 'a|b', severity: null, openedAt: NOW, resourceType: null, resourceName: '' });
    const b = incidentSubjectId({ id: '2', policy: 'a', severity: null, openedAt: NOW, resourceType: null, resourceName: 'b' });
    expect(a).not.toBe(b);
  });
});

describe('the family the detect cycle reads', () => {
  it('counts the estate as the policies, because that is what can tell you anything', async () => {
    /*
     * `total` is what this family can report on, and that is the enabled alerting policies — not the
     * number of virtual machines, which would count an estate nobody is watching as an estate that
     * has been checked.
     */
    const result = await load(google([alert()], [{ enabled: true }, { enabled: true }, { enabled: false }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({ total: 2, affected: 1 });
  });

  it('THE RULING: a refused read is a refusal, never a family with nothing wrong in it', async () => {
    // Recorded as read-and-clear, it would be a green mark on Health for a look that never happened.
    const result = await load(google([], [], 403));
    expect(result).toMatchObject({ ok: false, reason: 'denied' });
  });

  it('refuses a family it does not have rather than answering for it', async () => {
    const { monitoringProvider } = await import('@/lib/monitoring/provider-registry');
    const gcp = monitoringProvider('gcp');
    await expect(gcp.loadFamily!('ecs', target, NOW)).resolves.toMatchObject({ ok: false, code: 'unsupported_family' });
    // And an AWS target handed to it is a bug, not something to attempt.
    await expect(gcp.loadFamily!('gcp_alerts', { provider: 'aws' } as never, NOW)).resolves.toMatchObject({
      ok: false,
      code: 'wrong_target_provider',
    });
  });

  it('THE RULING: its insights survive the pipeline that was written for AWS', async () => {
    /*
     * The seam's whole claim. Nothing between here and a stored problem knows which cloud produced
     * the insight, so the proof is that the AWS-era adapter turns a Google one into an outcome with
     * the right subject, the right level and a family to be evaluated under.
     */
    const result = await load(google([alert()], [{ enabled: true }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [outcome] = outcomesFromInsights({ insights: result.data.insights, evaluated: [], nowMs: NOW });
    expect(outcome.state).toBe('fired');
    if (outcome.state !== 'fired') return;
    expect(outcome.kind).toBe('gcp_incident_open');
    // Shown as the thing Google named; keyed on the policy and the resource together.
    expect(outcome.subject.name).toBe('web-1');
    expect(outcome.subject.id).toContain('CPU above 90%');
    expect(outcome.problem.level).toBe('critical');
    // And a family, without which it could never be evaluated or resolved.
    expect(familyOfKind(outcome.kind)).toBe('gcp_alerts');
    // Linked to the Google page about it, never into the AWS rail.
    expect(outcome.problem.href).toBe('/accounts/c1/alerts');
    expect(outcome.problem.href.startsWith('/c/')).toBe(false);
  });
});
