import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LogoMark } from './logo-mark';

/**
 * A centered card under the OpsWatch mark: the sign-in and setup forms, the not-found and error messages.
 * It brings its own gutter, because `main` no longer pads: a monitoring page has to reach the edge.
 */
export function CenteredCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 px-4 pt-6 pb-10 md:pt-12">
      <LogoMark className="size-12" />
      <Card className="w-full shadow-sm [--card-spacing:--spacing(6)]">
        <CardHeader className="text-center">
          <CardTitle className="text-xl font-semibold tracking-tight"><h1>{title}</h1></CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}
