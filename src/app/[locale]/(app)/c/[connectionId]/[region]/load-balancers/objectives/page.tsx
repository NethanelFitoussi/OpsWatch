import { getTranslations } from 'next-intl/server';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { localizedTitle } from '@/i18n/metadata';
import { getDb } from '@/lib/db/client';
import { readHistorySettings } from '@/lib/history/settings';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { pageNow } from '@/lib/monitoring/shared/time-range';
import { measure, windowLabel } from '@/lib/read/slos';
import { listHistorySubjects } from '@/lib/store/history';
import { listSloDefinitions } from '@/lib/store/slos';
import { deleteObjectiveAction, saveObjectiveAction } from './actions';
import { ObjectivesForm } from './objectives-form';

type Props = { params: Promise<MonitoringParams> };

export const dynamic = 'force-dynamic';
export const generateMetadata = localizedTitle('Monitoring.objectives.title');

/** How far back the page looks for load balancers that have a stored series to offer as a subject. */
const SUBJECT_WINDOW_MS = 30 * 24 * 60 * 60_000;

/**
 * Service level objectives (§19).
 *
 * The page an operator writes their targets on. Until it existed every availability figure in OpsWatch was
 * measured against one hard-wired 99.9 %, which is a reasonable suggestion and nobody's decision — a batch
 * worker and a checkout API do not deserve the same number.
 *
 * Everything shown is computed from stored rollups, so opening it reads no AWS and costs nothing. With
 * historical collection off there is nothing to measure, and the page says that instead of showing targets
 * that look met.
 */
export default async function ObjectivesPage({ params }: Props) {
  const context = await initMonitoringRoute(params);
  const db = getDb();
  const t = await getTranslations('Monitoring.objectives');
  const { connectionId, region } = { connectionId: context.scope.connectionId, region: context.scope.region };
  const now = pageNow();
  const historyOn = readHistorySettings(db).enabled;

  const objectives = listSloDefinitions(db, connectionId, region).map((definition) => {
    // A definition is listed whether or not it is enabled; a disabled one is a target somebody paused,
    // not one they deleted. Only an enabled one is measured.
    const result = definition.enabled && historyOn ? measure(db, definition, now) : null;
    return {
      id: definition.id,
      name: definition.name,
      kind: definition.kind,
      subjectId: definition.subjectId,
      target: definition.objective,
      current: result?.current ?? null,
      status: result?.status ?? ('unknown' as const),
      budgetRemaining: result?.budgetRemaining ?? null,
      window: windowLabel(definition.windowDays),
      enabled: definition.enabled,
    };
  });

  const subjects = listHistorySubjects(db, {
    category: 'metric',
    connectionId,
    scope: region,
    metric: 'requests',
    resolution: '5m',
    fromMs: now - SUBJECT_WINDOW_MS,
    toMs: now,
  });

  return (
    <SectionLayout context={context} section="load-balancers" subsection="objectives">
      <MonitoringCard title={t('title')} description={t('description')}>
        <p className="text-sm text-muted-foreground">{t('measured')}</p>
        {/* Stated before any figure is read, so a screen of `unknown` is explained rather than mysterious. */}
        {!historyOn && <p className="mt-2 text-sm">{t('historyOff')}</p>}
      </MonitoringCard>

      <ObjectivesForm
        save={saveObjectiveAction.bind(null, context.locale, connectionId, region)}
        remove={deleteObjectiveAction.bind(null, context.locale, connectionId, region)}
        objectives={objectives}
        subjects={subjects}
      />
    </SectionLayout>
  );
}
