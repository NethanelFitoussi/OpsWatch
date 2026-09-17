import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { TargetGroup } from '@/lib/monitoring/elb';

vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => `t.${key}` }));
vi.mock('@/lib/monitoring/target', () => ({ resolveTarget: async () => ({ ok: false, reason: 'error', code: 'Boom', action: 'a' }) }));
// Not what this test is about: keep the failure branch to a single, dependency-free element.
vi.mock('@/components/monitoring/failure-notice', () => ({ FailureNotice: () => null }));

const { TargetGroupPanel } = await import('@/components/monitoring/target-group-panel');

const scope = { connectionId: 'conn-1', region: 'eu-west-1' };
const group = (arn: string, name = 'web'): TargetGroup => ({
  name,
  arn,
  protocol: 'HTTP',
  port: 80,
  targetType: 'ip',
  healthCheckPath: '/',
  loadBalancerArns: [],
});

async function headingIdOf(g: TargetGroup) {
  const html = renderToStaticMarkup(await TargetGroupPanel({ scope, group: g, range: '3h', nowMs: 0 }));
  const match = /<h3 id="([^"]+)"/.exec(html);
  if (!match) throw new Error(`no heading id in: ${html}`);
  return match[1];
}

describe('TargetGroupPanel heading id', () => {
  it('differs for two groups that share a name but have different ARNs', async () => {
    const a = await headingIdOf(group('arn:aws:elasticloadbalancing:eu-west-1:111111111111:targetgroup/web/aaaaaaaaaaaaaaaa', 'web'));
    const b = await headingIdOf(group('arn:aws:elasticloadbalancing:eu-west-1:111111111111:targetgroup/web/bbbbbbbbbbbbbbbb', 'web'));
    expect(a).not.toBe(b);
  });

  it('is stable for the same ARN', async () => {
    const arn = 'arn:aws:elasticloadbalancing:eu-west-1:111111111111:targetgroup/web/aaaaaaaaaaaaaaaa';
    expect(await headingIdOf(group(arn))).toBe(await headingIdOf(group(arn)));
  });
});
