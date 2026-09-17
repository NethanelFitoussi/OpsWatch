import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { titleTemplate } from '@/i18n/title';

/**
 * A centered page-level message (not found, error) with its action buttons. not-found and error files
 * cannot export metadata, so it also sets the document title; React places the <title> in the head.
 */
export function MessageCard({ title, description, actions }: { title: string; description: string; actions: ReactNode }) {
  const common = useTranslations('Common');
  return (
    <Card className="mx-auto max-w-md text-center">
      <title>{titleTemplate(common('appName'), title)}</title>
      <CardHeader>
        <CardTitle><h1>{title}</h1></CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap justify-center gap-3">{actions}</CardContent>
    </Card>
  );
}
