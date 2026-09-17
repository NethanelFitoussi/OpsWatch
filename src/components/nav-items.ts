import { BookOpen, Boxes, Cloud, Database, ScrollText, type LucideIcon } from 'lucide-react';

export type NavItem = {
  key: 'gettingStarted' | 'accounts' | 'containers' | 'databases' | 'logs';
  href: string;
  icon: LucideIcon;
  enabled: boolean;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'gettingStarted', href: '/getting-started', icon: BookOpen, enabled: true },
  { key: 'accounts', href: '/accounts', icon: Cloud, enabled: true },
  { key: 'containers', href: '/containers', icon: Boxes, enabled: false },
  { key: 'databases', href: '/databases', icon: Database, enabled: false },
  { key: 'logs', href: '/logs', icon: ScrollText, enabled: false },
];
