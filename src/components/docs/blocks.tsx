import { ArrowRight, CircleAlert, Info, Lightbulb } from 'lucide-react';
import type { ReactNode } from 'react';
import { CodeBlock } from '@/components/code-block';
import { MonitoringCard } from '@/components/monitoring/monitoring-card';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/**
 * The pieces every guide is built from.
 *
 * Six parts in the same order every time — what it does, before you start, steps, how to verify, common
 * problems, next — so a reader who has read one guide knows the shape of all of them. The point is not
 * consistency for its own sake: somebody following instructions at the wrong end of a bad morning should
 * never have to work out where the verification step is.
 *
 * No walls of text. A step is a card with a number, a sentence and, where it helps, one command to copy.
 */

/** A titled part of a guide. */
export function DocSection({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-3">
      <h2 className="font-heading text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

/** One numbered step, optionally with something to copy. */
export function DocStep({ index, title, children, command }: { index: number; title: string; children?: ReactNode; command?: string }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold tabular-nums">{index}</span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-medium">{title}</p>
        {children && <div className="text-sm text-muted-foreground">{children}</div>}
        {command !== undefined && <CodeBlock value={command} />}
      </div>
    </li>
  );
}

const CALLOUT = {
  info: { icon: Info, classes: 'border-sky-500/40 bg-sky-500/5' },
  warn: { icon: CircleAlert, classes: 'border-amber-500/40 bg-amber-500/5' },
  tip: { icon: Lightbulb, classes: 'border-emerald-500/40 bg-emerald-500/5' },
} as const;

export function DocCallout({ kind = 'info', children }: { kind?: keyof typeof CALLOUT; children: ReactNode }) {
  const { icon: Icon, classes } = CALLOUT[kind];
  return (
    <div className={cn('flex gap-3 rounded-lg border p-3 text-sm', classes)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * A chain of boxes with arrows between them: `CloudWatch → Collector → Rollups → Problems`.
 *
 * Drawn rather than screenshotted, because a diagram of OpsWatch's own architecture stays true when the
 * UI changes and a screenshot does not. It wraps to a column on a phone, where a row of six boxes would
 * be unreadable.
 */
export function DocFlow({ steps, label }: { steps: readonly { label: string; note?: string }[]; label: string }) {
  return (
    <ol className="flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:flex-wrap sm:items-stretch" aria-label={label}>
      {steps.map((step, index) => (
        <li key={step.label} className="flex items-center gap-2">
          <div className="min-w-0 rounded-md border bg-card px-3 py-2">
            <p className="text-sm font-medium">{step.label}</p>
            {step.note !== undefined && <p className="text-xs text-muted-foreground">{step.note}</p>}
          </div>
          {index < steps.length - 1 && <ArrowRight className="size-4 shrink-0 rotate-90 text-muted-foreground sm:rotate-0" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

/** A question somebody actually asks, and the answer. */
export function DocProblem({ question, children }: { question: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-sm font-medium">{question}</p>
      <div className="mt-1 text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

/** Where to go when this guide is finished, or the thing it just explained how to set up. */
export function DocNext({ href, label, external = false }: { href: string; label: string; external?: boolean }) {
  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {label} <ArrowRight className="size-3.5" aria-hidden />
      </a>
    );
  }
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline">
      {label} <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  );
}

/** The card a guide's body sits in, so every guide has the same margins and the same reading width. */
export function DocBody({ children }: { children: ReactNode }) {
  // The card is the reading column, not a full-width container with a narrow paragraph inside it: prose
  // stretched across 1400 px is unreadable, and a card stretched around narrow prose looks broken.
  return (
    <MonitoringCard title={<span className="sr-only">Guide</span>} className="max-w-3xl">
      <div className="space-y-8">{children}</div>
    </MonitoringCard>
  );
}
