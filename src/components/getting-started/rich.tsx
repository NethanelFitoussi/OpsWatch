import type { ReactNode } from 'react';

const link = 'font-medium text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground';

/** Tag renderers for `t.rich` in the guide: console and OpsWatch labels, code, caption markers and in-page links. */
export const richTags = {
  ui: (chunks: ReactNode) => <span className="font-medium text-foreground">{chunks}</span>,
  code: (chunks: ReactNode) => (
    <code className="rounded bg-foreground/[0.07] px-1 py-px font-mono text-[0.85em] text-foreground [overflow-wrap:anywhere]">{chunks}</code>
  ),
  m: (chunks: ReactNode) => (
    <span className="mx-0.5 inline-flex size-4 items-center justify-center rounded-full bg-primary align-[-0.2em] text-[10px] font-bold text-primary-foreground">
      {chunks}
    </span>
  ),
  services: (chunks: ReactNode) => <a href="#services" className={link}>{chunks}</a>,
  troubleshooting: (chunks: ReactNode) => <a href="#troubleshooting" className={link}>{chunks}</a>,
  role: (chunks: ReactNode) => <a href="#step-0" className={link}>{chunks}</a>,
};
