'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const NODES = [
  { id: 'account', x: 20, y: 20, w: 460, h: 370, container: true },
  { id: 'stack', x: 40, y: 62, w: 420, h: 310, container: true },
  { id: 'role', x: 60, y: 104, w: 380, h: 56, container: false },
  { id: 'permissions', x: 60, y: 196, w: 180, h: 70, container: false },
  { id: 'trust', x: 260, y: 196, w: 180, h: 70, container: false },
  { id: 'instance', x: 540, y: 104, w: 200, h: 56, container: false },
  { id: 'assumeRole', x: 540, y: 210, w: 200, h: 56, container: false },
  { id: 'credentials', x: 540, y: 316, w: 200, h: 56, container: false },
] as const;

type NodeId = (typeof NODES)[number]['id'];

export function ConnectionDiagram() {
  const t = useTranslations('GettingStarted.diagram');
  const [active, setActive] = useState<NodeId>('role');

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('hint')}</p>
      <svg viewBox="0 0 760 400" className="h-auto w-full" role="group" aria-label={t('title')}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="fill-muted-foreground" />
          </marker>
        </defs>

        <line x1="640" y1="160" x2="640" y2="208" className="stroke-muted-foreground" strokeWidth="1.5" markerEnd="url(#arrow)" />
        <line x1="540" y1="238" x2="442" y2="231" className="stroke-primary" strokeWidth="1.5" strokeDasharray="5 4" markerEnd="url(#arrow)" />
        <line x1="640" y1="266" x2="640" y2="314" className="stroke-muted-foreground" strokeWidth="1.5" markerEnd="url(#arrow)" />
        <line x1="150" y1="196" x2="150" y2="162" className="stroke-muted-foreground" strokeWidth="1.5" markerEnd="url(#arrow)" />
        <line x1="350" y1="196" x2="350" y2="162" className="stroke-muted-foreground" strokeWidth="1.5" markerEnd="url(#arrow)" />

        {NODES.map((node) => {
          const isActive = active === node.id;
          return (
            <g
              key={node.id}
              role="button"
              tabIndex={0}
              aria-pressed={isActive}
              aria-label={t(`nodes.${node.id}.label`)}
              onMouseEnter={() => setActive(node.id)}
              onFocus={() => setActive(node.id)}
              onClick={() => setActive(node.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setActive(node.id);
                }
              }}
              className="cursor-pointer outline-none"
            >
              <rect
                x={node.x}
                y={node.y}
                width={node.w}
                height={node.h}
                rx={node.container ? 14 : 10}
                className={cn(
                  'transition-colors',
                  node.container ? 'fill-muted/40' : 'fill-card',
                  isActive ? 'stroke-primary' : 'stroke-border',
                  node.id === 'instance' && 'fill-primary/10',
                )}
                strokeWidth={isActive ? 2.5 : 1.5}
                strokeDasharray={node.container ? '6 4' : undefined}
              />
              <text
                x={node.container ? node.x + 16 : node.x + node.w / 2}
                y={node.container ? node.y + 26 : node.y + node.h / 2 + 4}
                textAnchor={node.container ? 'start' : 'middle'}
                className={cn('fill-foreground text-[12px]', isActive && 'font-semibold')}
              >
                {t(`nodes.${node.id}.label`)}
              </text>
            </g>
          );
        })}
      </svg>
      <div aria-live="polite" className="rounded-lg border bg-card p-4">
        <p className="font-medium">{t(`nodes.${active}.label`)}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t(`nodes.${active}.description`)}</p>
      </div>
    </div>
  );
}
