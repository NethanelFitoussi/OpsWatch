import { BookOpen, Cloud, type LucideIcon } from 'lucide-react';
import type { AwsIconName } from './aws-icon';

export type NavItem = {
  key: 'gettingStarted' | 'accounts' | 'containers' | 'databases' | 'logs';
  href: string;
  /** A Lucide icon, or the AWS service icon of a section about that service. */
  icon: LucideIcon | AwsIconName;
  enabled: boolean;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'gettingStarted', href: '/getting-started', icon: BookOpen, enabled: true },
  { key: 'accounts', href: '/accounts', icon: Cloud, enabled: true },
  { key: 'containers', href: '/containers', icon: 'ecs', enabled: false },
  { key: 'databases', href: '/databases', icon: 'rds', enabled: false },
  { key: 'logs', href: '/logs', icon: 'logs', enabled: false },
];
