import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { CenteredCard } from '@/components/centered-card';
import { DocumentTitle } from '@/components/document-title';
import { titleTemplate } from '@/i18n/title';

/**
 * A centered page-level message (not found, error) with its action buttons. not-found and error files
 * cannot export metadata, so it also sets the document title.
 */
export function MessageCard({ title, description, actions }: { title: string; description: string; actions: ReactNode }) {
  const common = useTranslations('Common');
  return (
    <CenteredCard title={title} description={description}>
      <DocumentTitle title={titleTemplate(common('appName'), title)} />
      <div className="flex flex-wrap justify-center gap-3">{actions}</div>
    </CenteredCard>
  );
}
