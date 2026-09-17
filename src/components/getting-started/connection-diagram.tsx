'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { awsIconSrc, type AwsIconName } from '@/components/aws-icon';
import { cn } from '@/lib/utils';

type DiagramNode = {
  id: 'account' | 'stack' | 'role' | 'permissions' | 'trust' | 'instance' | 'assumeRole' | 'credentials';
  x: number;
  y: number;
  w: number;
  h: number;
  container: boolean;
  /** The AWS service the box stands for. The box label names it, so the icon is decorative. */
  icon?: AwsIconName;
};

const ICON = 24;

const NODES: readonly DiagramNode[] = [
  { id: 'account', x: 20, y: 20, w: 460, h: 300, container: true },
  { id: 'stack', x: 40, y: 62, w: 420, h: 238, container: true, icon: 'cloudformation' },
  { id: 'role', x: 60, y: 104, w: 380, h: 56, container: false, icon: 'iam' },
  { id: 'permissions', x: 60, y: 196, w: 180, h: 80, container: false, icon: 'iam' },
  { id: 'trust', x: 260, y: 196, w: 180, h: 80, container: false, icon: 'iam' },
  { id: 'instance', x: 540, y: 62, w: 200, h: 56, container: false },
  { id: 'assumeRole', x: 540, y: 163, w: 200, h: 56, container: false },
  { id: 'credentials', x: 540, y: 264, w: 200, h: 56, container: false },
];

/** Where the icon and the label of a box go: containers and the role put the icon before the label, the policies above it. */
function layout(node: DiagramNode) {
  if (node.container) {
    const labelX = node.x + 16 + (node.icon ? ICON + 8 : 0);
    return { icon: { x: node.x + 16, y: node.y + 12 }, text: { x: labelX, y: node.y + 29, anchor: 'start' as const } };
  }
  const centerX = node.x + node.w / 2;
  if (node.icon && node.h >= 80) {
    return { icon: { x: centerX - ICON / 2, y: node.y + 14 }, text: { x: centerX, y: node.y + 60, anchor: 'middle' as const } };
  }
  return { icon: { x: node.x + 16, y: node.y + (node.h - ICON) / 2 }, text: { x: centerX, y: node.y + node.h / 2 + 4, anchor: 'middle' as const } };
}

type NodeId = DiagramNode['id'];

export function ConnectionDiagram() {
  const t = useTranslations('GettingStarted.diagram');
  const [active, setActive] = useState<NodeId>('role');

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('hint')}</p>
      {/* Below 640 px the labels would be too small to read: the diagram keeps that width and scrolls sideways. */}
      <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        <svg viewBox="0 0 760 340" className="h-auto w-full min-w-[640px]" role="group" aria-label={t('title')}>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className="fill-muted-foreground" />
            </marker>
          </defs>

          <line x1="640" y1="118" x2="640" y2="161" className="stroke-muted-foreground" strokeWidth="1.5" markerEnd="url(#arrow)" />
          <line x1="540" y1="191" x2="442" y2="236" className="stroke-primary" strokeWidth="1.5" strokeDasharray="5 4" markerEnd="url(#arrow)" />
          <line x1="640" y1="219" x2="640" y2="262" className="stroke-muted-foreground" strokeWidth="1.5" markerEnd="url(#arrow)" />
          <line x1="150" y1="196" x2="150" y2="162" className="stroke-muted-foreground" strokeWidth="1.5" markerEnd="url(#arrow)" />
          <line x1="350" y1="196" x2="350" y2="162" className="stroke-muted-foreground" strokeWidth="1.5" markerEnd="url(#arrow)" />

          {NODES.map((node) => {
            const isActive = active === node.id;
            const place = layout(node);
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
                className="group cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
                    // Visible keyboard focus even where a browser draws no outline around SVG groups.
                    'group-focus-visible:stroke-ring group-focus-visible:[stroke-width:3.5]',
                    node.id === 'instance' && 'fill-primary/10',
                  )}
                  strokeWidth={isActive ? 2.5 : 1.5}
                  strokeDasharray={node.container ? '6 4' : undefined}
                />
                {node.icon && (
                  <image href={awsIconSrc(node.icon)} x={place.icon.x} y={place.icon.y} width={ICON} height={ICON} aria-hidden />
                )}
                <text
                  x={place.text.x}
                  y={place.text.y}
                  textAnchor={place.text.anchor}
                  className={cn('fill-foreground text-[13px]', isActive && 'font-semibold')}
                >
                  {t(`nodes.${node.id}.label`)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div aria-live="polite" className="rounded-lg border bg-card p-4">
        <p className="font-medium">{t(`nodes.${active}.label`)}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t(`nodes.${active}.description`)}</p>
      </div>
    </div>
  );
}
