import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';

/**
 * A chain of steps, drawn rather than described.
 *
 * Used where a guide has to show a *sequence* — GitHub's service → repository → deployment → commit →
 * changed files → problem, or the four bands an AI answer is read in. Plain elements rather than an SVG,
 * so it reflows at 360 px, inherits the theme's colours, and is read correctly by a screen reader.
 *
 * Deliberately not a screenshot of anybody's dashboard: a picture of a third party's UI goes stale the
 * moment they redesign it, and a diagram of what OpsWatch does cannot.
 */
export function ChainDiagram({ steps, label }: { steps: { title: string; detail: string }[]; label: string }) {
  return (
    <ol aria-label={label} className="flex flex-col gap-3 md:flex-row md:items-stretch">
      {steps.map((step, index) => (
        <li key={step.title} className="flex flex-1 items-center gap-3 md:flex-col md:items-stretch">
          <div className="min-w-0 flex-1 rounded-xl border bg-muted/30 p-4">
            <p className="text-sm font-semibold">{step.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.detail}</p>
          </div>
          {index < steps.length - 1 && (
            <ArrowRight className="size-4 shrink-0 rotate-90 text-muted-foreground md:rotate-0 md:self-center" aria-hidden />
          )}
        </li>
      ))}
    </ol>
  );
}

/** A labelled pair of facts — "what you give" against "what you get" — for a permissions section. */
export function FactGrid({ items }: { items: { term: string; detail: ReactNode }[] }) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.term} className="rounded-xl border p-4">
          <dt className="text-sm font-semibold">{item.term}</dt>
          <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.detail}</dd>
        </div>
      ))}
    </dl>
  );
}
