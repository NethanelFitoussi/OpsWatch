import 'server-only';
import { notFound } from 'next/navigation';
import { redirect } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import { initProtectedRoute } from '../auth/route';
import { findConnection } from '../connections/repository';
import type { ConnectionStatus, Provider } from '../connections/types';
import { getDb } from '../db/client';
import { appSettings } from '../settings/repository';
import type { AppSettings } from '../settings/shared';
import type { MonitoringScope } from './call';
import { checkSelection } from './selection';

export type MonitoringParams = { locale: string; connectionId: string; region: string };
/** `provider` is on it because a page's content depends on which cloud this is, not only on which account. */
type MonitoringConnection = { id: string; name: string; regions: string[]; status: ConnectionStatus; provider: Provider };
export type MonitoringPageContext = { locale: AppLocale; scope: MonitoringScope; connection: MonitoringConnection; settings: AppSettings };

/**
 * First statement of every monitoring page. Session first, then a database-only check of the connection and
 * region, all before any Suspense boundary so an unknown selection still answers 404.
 */
export async function initMonitoringRoute(params: Promise<MonitoringParams>): Promise<MonitoringPageContext> {
  const { locale } = await initProtectedRoute(params);
  const { connectionId, region } = await params;
  const db = getDb();
  const check = checkSelection(findConnection(db, connectionId), region);
  if (check.kind === 'not_found') notFound();
  if (check.kind === 'unusable') return redirect({ href: `/accounts/${check.connectionId}`, locale });
  const { id, name, regions, status, provider } = check.row;
  // Cached for 60 s, so a page and all its cards read the settings at most once.
  return { locale, scope: { connectionId: id, region }, connection: { id, name, regions, status, provider }, settings: appSettings.read(db) };
}
