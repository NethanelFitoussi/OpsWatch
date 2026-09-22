import type { NewProblem } from '@/lib/store/problems';
import type { DetectedProblem } from '@/lib/detect/types';

export const FIXED_NOW = Date.UTC(2026, 8, 19, 9, 0, 0);

export function newProblem(over: Partial<NewProblem> = {}): NewProblem {
  return {
    key: 'k'.repeat(32), connectionId: 'c1', scope: 'us-east-1', kind: 'ecs_cpu_high',
    subjectType: 'service', subjectId: 'prod/web', subjectName: 'web', serviceId: 'prod/web',
    source: 'aws', titleKey: 'Insights.messages.ecs_cpu_high', values: { service: 'web', value: 96 },
    severity: 'critical', score: 82,
    scoreTerms: { s: 1, b: 0.5, t: 1, u: 1, d: 0, weights: { s: 40, b: 20, t: 15, u: 15, d: 10 }, availableWeight: 100, rescaled: false, floored: false, score: 82 },
    href: '/c/c1/us-east-1/containers/services/prod/web',
    firstSeenAt: FIXED_NOW, lastSeenAt: FIXED_NOW, lastEvaluatedAt: FIXED_NOW, previousProblemId: null,
    evidence: [{ kind: 'metric', labelKey: 'Problems.evidence.cpu', values: {}, value: 96.2, unit: 'percent', at: FIXED_NOW }],
    ...over,
  };
}

/**
 * What a detector returns when it fires. The score inputs default to an established, wholly-broken,
 * user-facing service, so a test that cares about one term overrides only that term.
 */
export function detected(over: Partial<DetectedProblem> & { subjectId?: string } = {}): DetectedProblem {
  const subjectId = over.subjectId ?? 'prod/web';
  const rest: Partial<DetectedProblem> = { ...over };
  delete (rest as { subjectId?: string }).subjectId;
  return {
    kind: 'ecs_cpu_high',
    subject: { type: 'service', id: subjectId, name: subjectId, serviceId: subjectId },
    level: 'critical',
    titleKey: 'Insights.messages.ecs_cpu_high',
    values: { service: 'web', value: 96 },
    href: `/c/c1/us-east-1/containers/services/${subjectId}`,
    evidence: [{ kind: 'metric', labelKey: 'Problems.evidence.cpu', values: {}, value: 96.2, unit: 'percent', at: FIXED_NOW }],
    blast: { affected: 1, members: 1 },
    minutesBreaching: 60,
    userFacing: 'direct',
    robustZ: null,
    ...rest,
  };
}
