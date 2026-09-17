import { Check, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Building blocks for generic, console-like illustrations. They only duplicate the written sub-steps,
 * so the mock screen is hidden from assistive technology and the caption carries the meaning.
 */
export function MockFigure({ caption, children }: { caption: ReactNode; children: ReactNode }) {
  return (
    <figure className="max-w-2xl space-y-2">
      <div aria-hidden className="pointer-events-none select-none">{children}</div>
      <figcaption className="text-xs leading-relaxed text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}

export function MockWindow({
  breadcrumb,
  title,
  badge,
  children,
  footer,
}: {
  breadcrumb: string[];
  title: string;
  badge?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm ring-1 ring-foreground/[0.03]">
      <div className="flex items-center gap-1.5 border-b bg-muted/70 px-3 py-2">
        <span className="size-2.5 rounded-full bg-foreground/15" />
        <span className="size-2.5 rounded-full bg-foreground/15" />
        <span className="size-2.5 rounded-full bg-foreground/15" />
        <span className="ml-3 h-4 max-w-56 flex-1 rounded bg-background/80 ring-1 ring-border" />
      </div>
      <div className="px-4 pt-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
          {breadcrumb.map((item, index) => (
            <span key={index} className="inline-flex min-w-0 items-center gap-1">
              {index > 0 && <ChevronRight className="size-3 shrink-0 opacity-60" />}
              <span className={cn('truncate', index === breadcrumb.length - 1 && 'text-foreground')}>{item}</span>
            </span>
          ))}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-[15px] font-semibold tracking-tight [overflow-wrap:anywhere]">{title}</p>
          {badge}
        </div>
      </div>
      <div className="space-y-3 px-4 py-3.5 text-xs sm:px-5">{children}</div>
      {footer && <div className="flex flex-wrap items-center justify-end gap-2.5 border-t bg-muted/30 px-4 py-3 sm:px-5">{footer}</div>}
    </div>
  );
}

export function MockPanel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="space-y-2.5 rounded-lg border bg-background/60 p-3">
      {title && <p className="text-[13px] font-semibold">{title}</p>}
      {children}
    </div>
  );
}

/** Rings the element to act on and pins the numbered marker the caption refers to. */
export function Highlight({ n, className, children }: { n: number; className?: string; children: ReactNode }) {
  return (
    <span className={cn('relative inline-flex rounded-md ring-2 ring-primary ring-offset-2 ring-offset-card', className)}>
      {children}
      <span className="absolute -top-2.5 -right-2.5 z-10 flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground shadow-sm ring-2 ring-card">
        {n}
      </span>
    </span>
  );
}

export function MockButton({ primary, children }: { primary?: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center rounded-md px-3 text-[11px] font-semibold whitespace-nowrap',
        primary ? 'bg-primary text-primary-foreground' : 'border bg-background text-foreground',
      )}
    >
      {children}
    </span>
  );
}

/** Footer of a console wizard page: Cancel, optional extra buttons, then the highlighted primary action (marker 2). */
export function MockWizardFooter({ cancel, extra, primary }: { cancel: string; extra?: ReactNode; primary: string }) {
  return (
    <>
      <MockButton>{cancel}</MockButton>
      {extra}
      <Highlight n={2}><MockButton primary>{primary}</MockButton></Highlight>
    </>
  );
}

export function MockCheckbox({ checked, children }: { checked: boolean; children: ReactNode }) {
  return (
    <span className="flex items-start gap-2 text-left">
      <span
        className={cn(
          'mt-px flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border border-foreground/40 bg-background',
          checked && 'border-primary bg-primary text-primary-foreground',
        )}
      >
        {checked && <Check className="size-2.5" strokeWidth={3.5} />}
      </span>
      <span>{children}</span>
    </span>
  );
}

export function MockRadio({ selected, children }: { selected: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        'flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left',
        selected ? 'border-primary bg-primary/[0.06] font-medium' : 'bg-background/60',
      )}
    >
      <span className={cn('flex size-3.5 shrink-0 items-center justify-center rounded-full border border-foreground/40', selected && 'border-primary')}>
        {selected && <span className="size-1.5 rounded-full bg-primary" />}
      </span>
      <span>{children}</span>
    </span>
  );
}

export function MockField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="font-medium">{label}</p>
      <p className="max-w-64 rounded-md border bg-background px-2.5 py-1.5 font-mono">{value}</p>
    </div>
  );
}

export function MockSegmented({ items, active, highlight }: { items: string[]; active: number; highlight?: number }) {
  return (
    <span className="inline-flex gap-0.5 rounded-md border bg-muted/50 p-0.5">
      {items.map((item, index) => {
        const tab = (
          <span
            key={index}
            className={cn('rounded px-2.5 py-0.5 text-[11px] font-medium', index === active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}
          >
            {item}
          </span>
        );
        return index === active && highlight ? <Highlight key={index} n={highlight} className="rounded">{tab}</Highlight> : tab;
      })}
    </span>
  );
}

export function MockUnderlineTabs({ items, active }: { items: string[]; active: number }) {
  return (
    <div className="flex gap-4 overflow-hidden border-b text-[11px] whitespace-nowrap">
      {items.map((item, index) => (
        <span
          key={index}
          className={cn('-mb-px border-b-2 pb-1.5', index === active ? 'border-primary font-semibold text-foreground' : 'border-transparent text-muted-foreground')}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

export function MockCode({ lines, maxLines = 12 }: { lines: string[]; maxLines?: number }) {
  const shown = lines.slice(0, maxLines);
  return (
    <div className="overflow-hidden rounded-md border bg-muted/50 py-2 font-mono text-[11px] leading-5">
      {shown.map((line, index) => (
        <div key={index} className="flex">
          <span className="w-8 shrink-0 pr-3 text-right text-muted-foreground/60 tabular-nums">{index + 1}</span>
          <span className="truncate whitespace-pre">{line}</span>
        </div>
      ))}
      {lines.length > maxLines && <div className="pl-8 text-muted-foreground">…</div>}
    </div>
  );
}
