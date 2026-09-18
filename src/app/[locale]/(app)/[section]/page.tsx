import { notFound } from 'next/navigation';
import { redirect } from '@/i18n/navigation';
import { initProtectedRoute } from '@/lib/auth/route';
import { listConnections } from '@/lib/connections/repository';
import { getDb } from '@/lib/db/client';
import { firstUsableSelection } from '@/lib/monitoring/selection';
import { MONITORING_SECTIONS, subsectionPath } from '@/lib/monitoring/shared/paths';
import { defaultSubsection } from '@/lib/monitoring/shared/sections';
import { isOneOf } from '@/lib/type-guards';

type Props = { params: Promise<{ locale: string; section: string }> };

/** /<locale>/<section> without a selection: the first usable connection, its first region and the section's first sub-page, or Accounts. */
export default async function MonitoringRedirect({ params }: Props) {
  const { locale } = await initProtectedRoute(params);
  const { section } = await params;
  if (!isOneOf(MONITORING_SECTIONS, section)) notFound();
  const selection = firstUsableSelection(listConnections(getDb()));
  return redirect({ href: selection ? subsectionPath(selection, section, defaultSubsection(section)) : '/accounts', locale });
}
