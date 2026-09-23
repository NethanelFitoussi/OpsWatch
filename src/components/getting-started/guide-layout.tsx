import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { PageBody } from '@/components/page-body';
import { SectionHeading } from './section-heading';

/**
 * The shape every integration guide shares.
 *
 * One layout rather than four, so a reader who has followed the AWS guide already knows where the
 * permissions section is in the GitHub one — and so a guide cannot quietly omit a section by being written
 * differently. The state badge is measured, not decorative: a returning operator sees where they are.
 */
export function GuideLayout({
  title,
  subtitle,
  state,
  stateLabel,
  primary,
  secondary,
  children,
}: {
  title: string;
  subtitle: string;
  state: 'connected' | 'degraded' | 'not_configured' | 'unavailable';
  stateLabel: string;
  /** The action that does the thing the guide is about. Always lands somewhere real. */
  primary: { href: string; label: string };
  secondary: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <PageBody className="mx-auto max-w-5xl space-y-14">
      <header className="rounded-2xl border bg-gradient-to-br from-primary/10 via-background to-background px-6 py-10 md:px-10">
        <Badge variant={state === 'connected' ? 'default' : 'secondary'}>{stateLabel}</Badge>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">{title}</h1>
        <p className="mt-3 max-w-2xl text-lg text-muted-foreground">{subtitle}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild size="lg" variant={state === 'connected' ? 'outline' : 'default'}>
            <Link href={primary.href}>{primary.label}</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href={secondary.href}>
              <ArrowLeft className="size-4" aria-hidden /> {secondary.label}
            </Link>
          </Button>
        </div>
      </header>
      {children}
    </PageBody>
  );
}

/** One section of a guide, with the same heading treatment the AWS guide established. */
export function GuideSection({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 space-y-6">
      <SectionHeading as="h2" id={`${id}-title`} title={title} intro={intro} />
      {children}
    </section>
  );
}
