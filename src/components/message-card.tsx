import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** A centered page-level message (not found, error) with its action buttons. */
export function MessageCard({ title, description, actions }: { title: string; description: string; actions: ReactNode }) {
  return (
    <Card className="mx-auto max-w-md text-center">
      <CardHeader>
        <CardTitle><h1>{title}</h1></CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap justify-center gap-3">{actions}</CardContent>
    </Card>
  );
}
