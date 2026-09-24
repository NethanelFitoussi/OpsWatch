import { BookOpen, Bug, Cloud, Globe, LayoutDashboard, Settings, type LucideIcon } from 'lucide-react';
import { defaultSubsection } from '@/lib/monitoring/shared/sections';
import { parseMonitoringPath, subsectionPath, type MonitoringSection } from '@/lib/monitoring/shared/paths';
import type { AwsIconName } from './aws-icon';

type NavKey = 'overview' | 'errors' | 'containers' | 'instances' | 'databases' | 'loadBalancers' | 'alarms' | 'logs' | 'cloudflare' | 'gettingStarted' | 'settings' | 'accounts';
export type NavItem = {
  key: NavKey;
  /** A Lucide icon, or the AWS service icon of a section about that service. */
  icon: LucideIcon | AwsIconName;
} & ({ kind: 'monitoring'; section: MonitoringSection } | { kind: 'static'; href: string });

/** A section's own `Common.nav` key, so its name is written once for the rail, the breadcrumb and the section menu. */
export const SECTION_NAV_KEY: Record<MonitoringSection, NavKey> = {
  overview: 'overview',
  errors: 'errors',
  containers: 'containers',
  instances: 'instances',
  databases: 'databases',
  'load-balancers': 'loadBalancers',
  alarms: 'alarms',
  logs: 'logs',
};

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'overview', kind: 'monitoring', section: 'overview', icon: LayoutDashboard },
  { key: 'errors', kind: 'monitoring', section: 'errors', icon: Bug },
  { key: 'containers', kind: 'monitoring', section: 'containers', icon: 'ecs' },
  { key: 'instances', kind: 'monitoring', section: 'instances', icon: 'ec2' },
  { key: 'databases', kind: 'monitoring', section: 'databases', icon: 'rds' },
  { key: 'loadBalancers', kind: 'monitoring', section: 'load-balancers', icon: 'elb' },
  { key: 'alarms', kind: 'monitoring', section: 'alarms', icon: 'alarm' },
  { key: 'logs', kind: 'monitoring', section: 'logs', icon: 'logs' },
  // Instance-scoped rather than per environment: a Cloudflare zone belongs to the installation, so this
  // link carries no connection or region and sits below the sections that do.
  { key: 'cloudflare', kind: 'static', href: '/cloudflare', icon: Globe },
  { key: 'gettingStarted', kind: 'static', href: '/getting-started', icon: BookOpen },
  { key: 'settings', kind: 'static', href: '/settings', icon: Settings },
  { key: 'accounts', kind: 'static', href: '/accounts', icon: Cloud },
];

/** Monitoring links keep the current connection and region and open the section's default sub-page; elsewhere they open the section's redirect. */
export function navHref(item: NavItem, pathname: string): string {
  if (item.kind === 'static') return item.href;
  const current = parseMonitoringPath(pathname);
  return current ? subsectionPath(current, item.section, defaultSubsection(item.section)) : `/${item.section}`;
}

export function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.kind === 'static') return pathname === item.href || pathname.startsWith(`${item.href}/`);
  return parseMonitoringPath(pathname)?.section === item.section || pathname === `/${item.section}`;
}
