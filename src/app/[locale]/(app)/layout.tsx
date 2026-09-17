import { setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { requireAdmin } from '@/lib/auth/current';
import { listConnections } from '@/lib/connections/repository';
import { getDb } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

type Props = { children: React.ReactNode; params: Promise<{ locale: string }> };

export default async function ProtectedLayout({ children, params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin(locale);
  const connections = listConnections(getDb()).map(({ id, name, regions }) => ({ id, name, regions }));

  return (
    <AppShell signedIn connections={connections}>
      {children}
    </AppShell>
  );
}
