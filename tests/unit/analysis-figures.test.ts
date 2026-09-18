import { createElement } from 'react';
import { renderToReadableStream } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import en from '../../messages/en.json';

// The real catalogue behind a minimal next-intl: a dynamic key (`change.${kind}`, `heat.${tone}`) that no
// longer exists must fail the test rather than render its own name.
vi.mock('next-intl/server', () => ({
  getLocale: async () => 'en',
  getTranslations: async (namespace: string) => (key: string, values?: Record<string, string | number>) => {
    const message = `${namespace}.${key}`.split('.').reduce<unknown>((node, step) => (node as Record<string, unknown>)?.[step], en);
    if (typeof message !== 'string') throw new Error(`missing message ${namespace}.${key}`);
    return message.replaceAll(/\{(\w+)\}/g, (whole, name: string) => String(values?.[name] ?? whole));
  },
}));
vi.mock('@/i18n/navigation', () => ({ Link: (props: React.ComponentProps<'a'>) => createElement('a', props) }));

const { ChangeArrow, changeText } = await import('@/components/analysis/change-arrow');
const { HeatGrid } = await import('@/components/analysis/heat-grid');
const { KpiTile } = await import('@/components/analysis/kpi-tile');
const { TopNBars, barWidths } = await import('@/components/analysis/top-n-bars');

describe('changeText', () => {
  it('shows a signed percentage for a comparable change', () => {
    expect(changeText({ kind: 'up', ratio: 0.2 }, 'en')).toBe('+20%');
    expect(changeText({ kind: 'down', ratio: -0.205 }, 'en')).toBe('-20.5%');
    expect(changeText({ kind: 'flat', ratio: 0.004 }, 'en')).toBe('+0.4%');
    expect(changeText({ kind: 'new' }, 'en')).toBe('—');
    expect(changeText({ kind: 'unavailable' }, 'en')).toBe('—');
  });
  it('formats in French with its own separator', () => {
    // ICU puts a no-break space (U+00A0) before the French percent sign.
    expect(changeText({ kind: 'down', ratio: -0.205 }, 'fr')).toBe('-20,5\u00a0%');
  });
});

describe('barWidths', () => {
  const items = [
    { id: 'a', name: 'a', value: 100 },
    { id: 'b', name: 'b', value: 25 },
    { id: 'c', name: 'c', value: null },
  ];
  it('scales to the largest value when no maximum is given', () => {
    expect(barWidths(items, undefined)).toEqual([100, 25, 0]);
  });
  it('scales to an explicit maximum and clamps above it', () => {
    expect(barWidths(items, 200)).toEqual([50, 12.5, 0]);
    expect(barWidths([{ id: 'a', name: 'a', value: 300 }], 200)).toEqual([100]);
  });
  it('gives every row zero width when nothing is comparable', () => {
    expect(barWidths([{ id: 'a', name: 'a', value: 0 }, { id: 'b', name: 'b', value: 0 }], undefined)).toEqual([0, 0]);
    expect(barWidths([], undefined)).toEqual([]);
    expect(barWidths(items, 0)).toEqual([0, 0, 0]);
  });
  it('rounds to one decimal', () => {
    expect(barWidths([{ id: 'a', name: 'a', value: 1 }, { id: 'b', name: 'b', value: 3 }], undefined)).toEqual([33.3, 100]);
  });
});

/** The streaming renderer, not `renderToStaticMarkup`: only it awaits a nested async server component. */
async function render(element: React.JSX.Element): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return await new Response(stream).text();
}

/** What a screen reader announces: the text, minus whatever is hidden from the accessibility tree. */
function announced(html: string): string {
  return html
    .replaceAll(/<(span|svg)[^>]*\baria-hidden\b[^>]*>[\s\S]*?<\/\1>/g, '')
    .replaceAll(/<[^>]+>/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

describe('ChangeArrow', () => {
  it('says which way the figure moved, once, against the named window', async () => {
    const html = await render(await ChangeArrow({ change: { kind: 'up', ratio: 0.2 }, rangeKey: '12h' }));
    expect(html).toContain('+20%'); // the number stays visible
    expect(announced(html)).toBe('Up +20% against the previous 12 hours');
    expect(html).toContain('text-red-600'); // a rise is the bad direction for every metric this stage ranks
  });

  it('announces a flat window and a missing comparison without repeating itself', async () => {
    const flat = await render(await ChangeArrow({ change: { kind: 'flat', ratio: 0.004 }, rangeKey: '3h' }));
    expect(announced(flat)).toBe('Unchanged against the previous 3 hours');
    const missing = await render(await ChangeArrow({ change: { kind: 'unavailable' }, rangeKey: '7d' }));
    expect(announced(missing)).toBe('No comparison available');
    expect(missing).toContain('—'); // the cell is never simply blank
  });

  it('shows something visible and announces one sentence, whichever kind it is', async () => {
    const changes = [
      { kind: 'up', ratio: 0.2 },
      { kind: 'down', ratio: -0.2 },
      { kind: 'flat', ratio: 0 },
      { kind: 'new' },
      { kind: 'unavailable' },
    ] as const;
    for (const change of changes) {
      const html = await render(await ChangeArrow({ change, rangeKey: '24h' }));
      const sentence = announced(html);
      expect(sentence).not.toBe(''); // never silent
      expect(html.replaceAll(/<[^>]+>/g, ' ').replaceAll(/\s+/g, ' ').trim()).not.toBe(''); // never blank on screen
      // The sentence is announced exactly once, whether it is the visible text or only the hidden one.
      expect(html.split(sentence)).toHaveLength(2);
    }
  });

  it('spells out the kinds that have no figure and shows the figure for the kinds that have one', async () => {
    const isNew = await render(await ChangeArrow({ change: { kind: 'new' }, rangeKey: '24h' }));
    expect(isNew).toContain('No value in the previous 24 hours'); // the fact itself is the visible text
    expect(isNew).not.toContain('sr-only');
    const down = await render(await ChangeArrow({ change: { kind: 'down', ratio: -0.2 }, rangeKey: '24h' }));
    expect(down).toContain('<span aria-hidden="true">-20%</span>'); // the figure carries the cell
    expect(down).toContain('sr-only');
  });
});

describe('HeatGrid', () => {
  it('gives every tile a link, hover text and the same text for a screen reader', async () => {
    const html = await render(
      await HeatGrid({
        label: 'CPU by instance',
        unit: 'percent',
        cells: [
          { id: 'i-1', name: 'web-1', value: 91, tone: 'danger', href: '/i/i-1' },
          { id: 'i-2', name: 'web-2', value: null, tone: null, href: '/i/i-2' },
        ],
      }),
    );
    expect(html).toMatch(/<ul role="list"[^>]*aria-label="CPU by instance"/);
    expect(html).toContain('title="web-1 — 91%"');
    expect(html).toContain('title="web-2 — —"');
    expect(html).toContain('href="/i/i-1"');
    expect(announced(html)).toContain('web-1 — 91%');
    expect(announced(html)).toContain('Healthy Warning Critical No data'); // the legend names every tone
  });
});

describe('KpiTile', () => {
  it('shows the figure, its window and the change, and links the whole tile', async () => {
    const html = await render(
      await KpiTile({
        label: 'Errors',
        value: 4200,
        unit: 'count',
        tone: 'warning',
        windowLabel: 'over the last 12 hours',
        change: { kind: 'down', ratio: -0.3 },
        rangeKey: '12h',
        href: '/errors',
      }),
    );
    expect(html).toContain('<a href="/errors"');
    expect(html).toContain('4,200'); // under ten thousand a count stays exact
    expect(html).toContain('over the last 12 hours');
    expect(announced(html)).toContain('Down -30% against the previous 12 hours');
    expect(html).toContain('bg-amber-100'); // the tone tints the tile
  });

  it('stays neutral and shows no arrow without a tone or a comparison', async () => {
    const html = await render(
      await KpiTile({ label: 'Errors', value: null, unit: 'count', tone: null, windowLabel: 'over the last 3 hours' }),
    );
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('amber');
    expect(html).toContain('—'); // no value is a dash, not a zero
  });
});

describe('TopNBars', () => {
  it('names the ranking and every row from the catalogue', async () => {
    const html = await render(
      await TopNBars({
        label: 'Errors',
        unit: 'count',
        items: [
          { id: 'a', name: 'checkout', value: 120, href: '/s/a', tone: 'danger' },
          { id: 'b', name: 'search', value: 30 },
        ],
      }),
    );
    expect(html).toContain('aria-label="Errors, highest first"');
    expect(html).toContain('aria-label="checkout: 120"');
    expect(html).toContain('aria-label="search: 30"');
    expect(html).toContain('width:100%'); // the widest row fills the track
    expect(html).toContain('width:25%');
  });
});
