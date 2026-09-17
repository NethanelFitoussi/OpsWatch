import type { ShellConnection } from './connection-switcher';
import { Sidebar } from './sidebar';
import { TopBar } from './top-bar';

export function AppShell({
  children,
  signedIn,
  connections,
}: {
  children: React.ReactNode;
  signedIn: boolean;
  connections?: ShellConnection[];
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar signedIn={signedIn} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar signedIn={signedIn} connections={connections} />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:px-8">{children}</main>
      </div>
    </div>
  );
}
