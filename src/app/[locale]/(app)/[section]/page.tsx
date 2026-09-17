import { notFound } from 'next/navigation';
import { redirect } from '@/i18n/navigation';
import { initProtectedRoute } from '@/lib/auth/route';
import { listConnections } from '@/lib/connections/repository';
import { getDb } from '@/lib/db/client';
import { firstUsableSelection } from '@/lib/monitoring/selection';
import { MONITORING_SECTIONS, monitoringPath } from '@/lib/monitoring/shared/paths';
import { isOneOf } from '@/lib/type-guards';

type Props = { params: Promise<{ locale: string; section: string }> };

/** /<locale>/<section> without a selection: the first usable connection and its first region, or Accounts. */
export default async function MonitoringRedirect({ params }: Props) {
  const { locale } = await initProtectedRoute(params);
  const { section } = await params;
  if (!isOneOf(MONITORING_SECTIONS, section)) notFound();
  const selection = firstUsableSelection(listConnections(getDb()));
  return redirect({ href: selection ? monitoringPath(selection, section) : '/accounts', locale });
}
