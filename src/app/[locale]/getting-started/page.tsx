import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { ConnectionDiagram } from '@/components/getting-started/connection-diagram';
import { MethodCards } from '@/components/getting-started/method-cards';
import { SectionHeading } from '@/components/getting-started/section-heading';
import { SecuritySection } from '@/components/getting-started/security-section';
import { ServiceCards } from '@/components/getting-started/service-cards';
import { Steps } from '@/components/getting-started/steps';
import { Troubleshooting } from '@/components/getting-started/troubleshooting';
import { Button } from '@/components/ui/button';
import { localizedTitle } from '@/i18n/metadata';
import { Link } from '@/i18n/navigation';
import { getCurrentAdminId } from '@/lib/auth/current';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string }> };

export const generateMetadata = localizedTitle('GettingStarted.metaTitle');

function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 space-y-6">
      <div>
        <SectionHeading as="h2" id={`${id}-title`} title={title} intro={intro} />
      </div>
      {children}
    </section>
  );
}

export default async function GettingStartedPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('GettingStarted');
  const signedIn = (await getCurrentAdminId()) !== null;

  return (
    <AppShell signedIn={signedIn}>
      <div className="space-y-16">
        <header className="rounded-2xl border bg-gradient-to-br from-primary/10 via-background to-background px-6 py-10 md:px-10">
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{t('title')}</h1>
          <p className="mt-3 max-w-2xl text-lg text-muted-foreground">{t('subtitle')}</p>
          <Button asChild size="lg" className="mt-6">
            <Link href="/accounts/new">{t('cta')}</Link>
          </Button>
        </header>

        <Section id="methods" title={t('methodsTitle')}>
          <MethodCards />
        </Section>

        <Section id="how-it-works" title={t('diagram.title')}>
          <ConnectionDiagram />
        </Section>

        <Section id="steps" title={t('stepsTitle')}>
          <Steps />
        </Section>

        <Section id="services" title={t('servicesTitle')} intro={t('servicesIntro')}>
          <ServiceCards />
        </Section>

        <Section id="security" title={t('security.title')}>
          <SecuritySection />
        </Section>

        <Section id="troubleshooting" title={t('troubleshooting.title')}>
          <Troubleshooting />
        </Section>
      </div>
    </AppShell>
  );
}
