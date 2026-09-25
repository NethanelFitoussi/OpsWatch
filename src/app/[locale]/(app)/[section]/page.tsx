import { notFound } from 'next/navigation';
import { redirect } from '@/i18n/navigation';
import { initProtectedRoute } from '@/lib/auth/route';
import { listConnections } from '@/lib/connections/repository';
import { getDb } from '@/lib/db/client';
import { preferredSelection } from '@/lib/monitoring/selection';
import { readPreferences } from '@/lib/store/preferences';
import { MONITORING_SECTIONS, subsectionPath } from '@/lib/monitoring/shared/paths';
import { defaultSubsection } from '@/lib/monitoring/shared/sections';
import { isOneOf } from '@/lib/type-guards';

type Props = { params: Promise<{ locale: string; section: string }> };

/**
 * `/<locale>/<section>` without a selection: the operator's own environment, the section's first
 * sub-page, or Accounts when there is nothing to monitor.
 *
 * Their own, not the first one that happens to be usable. With two AWS accounts connected, somebody
 * working in Client B who visited Settings and clicked *Containers* silently landed in Production.
 */
export default async function MonitoringRedirect({ params }: Props) {
  const { locale, adminId } = await initProtectedRoute(params);
  const { section } = await params;
  if (!isOneOf(MONITORING_SECTIONS, section)) notFound();
  const db = getDb();
  const selection = preferredSelection(listConnections(db), readPreferences(db, adminId).defaultEnvironmentId);
  return redirect({ href: selection ? subsectionPath(selection, section, defaultSubsection(section)) : '/accounts', locale });
}
