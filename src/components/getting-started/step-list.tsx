import type { ReactNode } from 'react';
import { StepNumber } from '@/components/step-number';
import { SectionHeading } from './section-heading';

export type SubStep = { content: ReactNode; extra?: ReactNode };

export function Method({ id, title, intro, children }: { id?: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-20">
      <SectionHeading as="h3" title={title} intro={intro} />
      <ol className="mt-8 space-y-10">{children}</ol>
    </div>
  );
}

export function Step({ id, number, title, purpose, children }: { id?: string; number: number; title: string; purpose: ReactNode; children: ReactNode }) {
  return (
    <li id={id} className="scroll-mt-20">
      <div className="flex items-center gap-3">
        <StepNumber number={number} />
        <h4 className="text-lg leading-snug font-semibold">{title}</h4>
      </div>
      <div className="mt-3 min-w-0 space-y-5 sm:ml-4 sm:border-l sm:pb-2 sm:pl-8">
        <p className="max-w-3xl text-muted-foreground">{purpose}</p>
        {children}
      </div>
    </li>
  );
}

export function SubSteps({ items }: { items: SubStep[] }) {
  return (
    <ol className="max-w-3xl space-y-4">
      {items.map((item, index) => (
        <li key={index} className="flex gap-3">
          <span className="mt-px flex size-6 shrink-0 items-center justify-center rounded-full border bg-background text-xs font-semibold text-muted-foreground tabular-nums">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1 space-y-4 text-sm leading-relaxed text-foreground/85">
            <p>{item.content}</p>
            {item.extra}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function SubSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
      <h5 className="font-semibold">{title}</h5>
      {children}
    </section>
  );
}
