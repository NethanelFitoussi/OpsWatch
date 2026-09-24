import { getTranslations } from 'next-intl/server';
import { PageBody } from '@/components/page-body';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { localizedTitle } from '@/i18n/metadata';
import { Link } from '@/i18n/navigation';
import { initProtectedRoute } from '@/lib/auth/route';
import { SEARCH_MAX } from '@/lib/limits';
import { DOC_CATEGORIES, docPath, guidesInCategory, searchGuides, type DocGuide } from '@/lib/docs/catalogue';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ q?: string | string[] }> };

export const generateMetadata = localizedTitle('Docs.title');

/**
 * The documentation, as a product surface rather than a README.
 *
 * Categories first, because somebody who does not know what they are looking for needs a shape to read;
 * search second, because somebody who does know types three words. The search matches keywords the guides
 * themselves do not use — an operator looking for "save metrics" does not know the feature is called
 * historical collection.
 */
export default async function DocsPage({ params, searchParams }: Props) {
  await initProtectedRoute(params);
  const sp = await searchParams;
  const query = ((Array.isArray(sp.q) ? sp.q[0] : sp.q) ?? '').trim().slice(0, SEARCH_MAX);
  const t = await getTranslations('Docs');
  const guides = await getTranslations('Docs.guides');

  const text = (slug: string) => ({ title: guides(`${slug}.title`), summary: guides(`${slug}.summary`) });
  const results = query.length > 0 ? searchGuides(query, text) : [];

  const card = (guide: DocGuide) => (
    <li key={guide.slug}>
      <Card className="relative h-full gap-2 transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-ring">
        <CardHeader>
          <CardTitle className="text-base font-semibold">
            <Link href={docPath(guide.slug)} className="rounded-sm after:absolute after:inset-0 focus-visible:outline-none">
              {guides(`${guide.slug}.title`)}
            </Link>
          </CardTitle>
          <CardDescription>{guides(`${guide.slug}.summary`)}</CardDescription>
        </CardHeader>
      </Card>
    </li>
  );

  return (
    <PageBody>
      <PageHeader title={t('title')} description={t('description')} />

      <form className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm sm:max-w-md">
          {t('searchLabel')}
          <Input name="q" type="search" defaultValue={query} maxLength={SEARCH_MAX} placeholder={t('searchPlaceholder')} />
        </label>
        <Button type="submit">{t('searchSubmit')}</Button>
      </form>

      {query.length > 0 ? (
        <section className="space-y-3">
          <h2 className="font-heading text-lg font-semibold tracking-tight">{t('results', { count: results.length, query })}</h2>
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noResults')}</p>
          ) : (
            <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{results.map(card)}</ul>
          )}
        </section>
      ) : (
        DOC_CATEGORIES.map((category) => (
          <section key={category} className="space-y-3">
            <div>
              <h2 className="font-heading text-lg font-semibold tracking-tight">{t(`categories.${category}.title`)}</h2>
              <p className="text-sm text-muted-foreground">{t(`categories.${category}.description`)}</p>
            </div>
            <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{guidesInCategory(category).map(card)}</ul>
          </section>
        ))
      )}
    </PageBody>
  );
}
