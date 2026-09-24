import { ArrowLeft } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PageBody } from '@/components/page-body';
import { PageHeader } from '@/components/page-header';
import { Link } from '@/i18n/navigation';
import { initProtectedRoute } from '@/lib/auth/route';
import { DOC_SLUGS, findGuide } from '@/lib/docs/catalogue';
import { GuideView } from './guide-view';

type Props = { params: Promise<{ locale: string; slug: string }> };

export function generateStaticParams() {
  return DOC_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props) {
  const { locale, slug } = await params;
  if (findGuide(slug) === null) return {};
  const t = await getTranslations({ locale, namespace: `Docs.guides.${slug}` });
  // The layout's template adds the product name; adding it here too said it twice.
  return { title: t('title') };
}

export default async function DocPage({ params }: Props) {
  await initProtectedRoute(params);
  const { slug } = await params;
  const guide = findGuide(slug);
  if (guide === null) notFound();

  const t = await getTranslations(`Docs.guides.${slug}`);
  const common = await getTranslations('Docs');

  return (
    <PageBody>
      <Link
        href="/docs"
        className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ArrowLeft className="size-4" aria-hidden /> {common('allGuides')}
      </Link>
      <PageHeader title={t('title')} description={t('summary')} />
      <GuideView guide={guide} />
    </PageBody>
  );
}
