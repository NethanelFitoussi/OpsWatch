import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { StatusSegment } from '@/components/analysis/status-bar';

// next-intl's Link only adds the locale prefix; the accessibility of the bar is decided by the markup around it.
vi.mock('@/i18n/navigation', () => ({ Link: (props: React.ComponentProps<'a'>) => createElement('a', props) }));

const { StatusBar } = await import('@/components/analysis/status-bar');

const segments: StatusSegment[] = [
  { key: 'healthy', label: '7 healthy', count: 7, tone: 'success', href: '/s?state=healthy' },
  { key: 'degraded', label: '2 degraded', count: 2, tone: 'danger', href: '/s?state=degraded' },
  { key: 'stopped', label: '0 stopped', count: 0, tone: 'info', href: '/s?state=stopped' },
];

async function render(): Promise<string> {
  const element = await StatusBar({ segments, label: 'Service states' });
  if (!element) throw new Error('nothing rendered');
  return renderToStaticMarkup(element);
}

/** What a screen reader announces for a link: its text, minus whatever is hidden from the accessibility tree. */
function accessibleNames(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map(([, inner]) =>
    inner
      .replace(/<span[^>]*\baria-hidden\b[^>]*>[\s\S]*?<\/span>/g, '')
      .replace(/<[^>]+>/g, '')
      .trim(),
  );
}

describe('StatusBar', () => {
  it('exposes every segment as a link with an accessible name', async () => {
    const html = await render();
    expect(html).not.toContain('role="img"'); // role="img" hides the links from assistive technology
    expect(accessibleNames(html)).toEqual(['7 healthy', '2 degraded']);
    expect(html).toContain('href="/s?state=healthy"');
    expect(html).toContain('href="/s?state=degraded"');
    expect(html).not.toContain('state=stopped'); // an empty state has no segment
  });

  it('names the bar itself and keeps the legend under it', async () => {
    const html = await render();
    expect(html).toMatch(/<ul[^>]*aria-label="Service states"/);
    expect(html.match(/<li\b/g)).toHaveLength(4); // two segments in the bar, the same two in the legend
    expect(html).toContain('bg-emerald-500'); // the legend dot still carries the tone
    expect(html).toContain('bg-red-500');
  });

  it('renders nothing when every state is empty', async () => {
    expect(await StatusBar({ segments: [segments[2]], label: 'Service states' })).toBeNull();
  });
});
