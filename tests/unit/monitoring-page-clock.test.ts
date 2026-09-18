import { isValidElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { timeWindow, type TimeRange } from '@/lib/monitoring/shared/time-range';

const SCOPE = { connectionId: 'abc123def456', region: 'eu-west-1' };

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
  getFormatter: async () => ({}),
  getLocale: async () => 'en',
  setRequestLocale: () => undefined,
}));
vi.mock('@/lib/monitoring/route', () => ({
  initMonitoringRoute: async () => ({
    locale: 'en',
    scope: SCOPE,
    connection: { id: SCOPE.connectionId, name: 'production', regions: [SCOPE.region], status: 'ok' },
  }),
}));

const { default: OverviewPage } = await import('@/app/[locale]/(app)/c/[connectionId]/[region]/overview/insights/page');
const { default: LoadBalancerPage } = await import('@/app/[locale]/(app)/c/[connectionId]/[region]/load-balancers/list/[name]/page');
const { default: ContainersPage } = await import('@/app/[locale]/(app)/c/[connectionId]/[region]/containers/services/page');

/** Every `nowMs` a page hands to a card, wherever it sits in the returned element tree. */
function clocks(node: ReactNode): number[] {
  if (Array.isArray(node)) return node.flatMap(clocks);
  if (!isValidElement(node)) return [];
  const props = node.props as { nowMs?: unknown; children?: ReactNode };
  return [...(typeof props.nowMs === 'number' ? [props.nowMs] : []), ...clocks(props.children)];
}

/** A clock that jumps a whole minute on every read, so a second read would land in another window. */
function tickingClock(start = Date.parse('2026-09-17T10:00:59.900Z')) {
  let calls = 0;
  return vi.spyOn(Date, 'now').mockImplementation(() => start + calls++ * 60_000);
}

const params = <T extends Record<string, string>>(extra = {} as T) => Promise.resolve({ locale: 'en', ...SCOPE, ...extra });

function expectOneWindow(values: number[], range: TimeRange, count: number) {
  expect(values).toHaveLength(count);
  expect(new Set(values).size).toBe(1);
  expect(new Set(values.map((value) => timeWindow(range, value).end.getTime())).size).toBe(1);
}

afterEach(() => vi.restoreAllMocks());

describe('one clock per page render', () => {
  it('gives the four Overview families and the insights card the same window', async () => {
    const clock = tickingClock();
    const page = await OverviewPage({ params: params() });
    // Four summary cards and the insights card: the five loads share their cache entries.
    expectOneWindow(clocks(page), '3h', 5);
    expect(clock).toHaveBeenCalledTimes(1);
  });

  it('gives every card of a load balancer page the same window', async () => {
    const clock = tickingClock();
    const page = await LoadBalancerPage({ params: params({ name: 'opswatch-alb' }), searchParams: Promise.resolve({ range: '12h' }) });
    expectOneWindow(clocks(page), '12h', 2);
    expect(clock).toHaveBeenCalledTimes(1);
  });

  it('gives a list page its own clock too', async () => {
    const clock = tickingClock();
    const page = await ContainersPage({ params: params(), searchParams: Promise.resolve({ range: '1h' }) });
    expectOneWindow(clocks(page), '1h', 1);
    expect(clock).toHaveBeenCalledTimes(1);
  });
});
