import { ArrowLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { SectionLayout } from '@/components/monitoring/section-layout';
import { SuspenseCard } from '@/components/monitoring/suspense-card';
import { Link } from '@/i18n/navigation';
import { localizedTitle } from '@/i18n/metadata';
import { initMonitoringRoute, type MonitoringParams } from '@/lib/monitoring/route';
import { subsectionPath } from '@/lib/monitoring/shared/paths';
import { AlarmDetail } from './detail';

type Props = { params: Promise<MonitoringParams & { name: string }> };

export const generateMetadata = localizedTitle('Monitoring.alarms.detail.title');

export default async function AlarmDetailPage({ params }: Props) {
  const context = await initMonitoringRoute(params);
  const { name } = await params;
  const alarmName = decodeURIComponent(name);
  const t = await getTranslations('Monitoring.alarms');

  return (
    <SectionLayout context={context} section="alarms" subsection="list" title={alarmName} description={t('detail.description')}>
      <Link
        href={subsectionPath(context.scope, 'alarms', 'list')}
        className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ArrowLeft className="size-4" aria-hidden /> {t('detail.backToList')}
      </Link>
      <SuspenseCard title={t('detail.whatIsThis')} variant="table" rows={4}>
        <AlarmDetail scope={context.scope} name={alarmName} />
      </SuspenseCard>
    </SectionLayout>
  );
}
