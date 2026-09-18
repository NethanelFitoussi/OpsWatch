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
        {/* No maximum width and no padding of its own: a wide screen is filled, and a monitoring page's
            section menu sits flush against the rail. Each page brings its own gutter, through `PageBody`
            or, for a monitoring sub-page, through `SectionLayout`. */}
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
