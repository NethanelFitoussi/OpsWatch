import { createElement } from 'react';
import { renderToReadableStream } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { SortState } from '@/lib/monitoring/shared/table-sort';
import en from '../../messages/en.json';

// The real catalogue behind a minimal next-intl, so a key the table names but the catalogue lost fails here.
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace?: string) => (key: string, values?: Record<string, string | number>) => {
    const path = namespace ? `${namespace}.${key}` : key;
    const message = path.split('.').reduce<unknown>((node, step) => (node as Record<string, unknown>)?.[step], en);
    if (typeof message !== 'string') throw new Error(`missing message ${path}`);
    return message.replaceAll(/\{(\w+)\}/g, (whole, name: string) => String(values?.[name] ?? whole));
  },
}));
vi.mock('@/i18n/navigation', () => ({ Link: (props: React.ComponentProps<'a'>) => createElement('a', props) }));

const { DenseTable, columnClass } = await import('@/components/analysis/dense-table');

describe('columnClass', () => {
  it('drops the least important columns first as the screen narrows', () => {
    expect(columnClass('always')).toBe('');
    expect(columnClass(undefined)).toBe('');
    expect(columnClass('sm')).toBe('hidden sm:table-cell');
    expect(columnClass('md')).toBe('hidden md:table-cell');
    expect(columnClass('lg')).toBe('hidden lg:table-cell');
  });
});

/** The streaming renderer, not `renderToStaticMarkup`: only it awaits a nested async server component. */
async function render(element: React.JSX.Element): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return await new Response(stream).text();
}

const columns = [
  { id: 'name', label: 'Name', sortable: true },
  { id: 'cpu', label: 'CPU', align: 'right' as const, priority: 'md' as const, sortable: true },
  { id: 'note', label: 'Note' },
];
const rows = [
  { id: 'a', cells: { name: 'web-1', cpu: '91%', note: 'busy' }, tone: 'danger' as const },
  { id: 'b', cells: { name: 'web-2', cpu: '4%', note: 'idle' } },
];
const base = { caption: 'Instances', columns, rows, shown: 2, total: 5, emptyKey: 'Monitoring.databases.empty' };
const state: SortState = { column: 'cpu', direction: 'desc' };

describe('DenseTable', () => {
  it('links every sortable header and marks the sorted one for assistive technology', async () => {
    const html = await render(await DenseTable({ ...base, sorting: { state, href: (column) => `/db?sort=${column}:asc` } }));
    expect(html).toContain('<a href="/db?sort=name:asc"');
    expect(html).toContain('aria-label="Sort by CPU"');
    expect(html).toMatch(/aria-sort="none"[^>]*>[\s\S]*?Sort by Name/); // an unsorted but sortable column
    expect(html).toContain('aria-sort="descending"');
    expect(html).not.toContain('aria-sort="ascending"');
    expect(html).toContain('Showing 2 of 5');
    expect(html).toContain('border-l-red-500'); // the row tone is an edge, not colour alone
    expect(html).toContain('hidden md:table-cell'); // the CPU column steps aside at 360 px
  });

  it('renders plain headers, and no sort affordance at all, when the page does not sort', async () => {
    const html = await render(await DenseTable(base));
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('aria-sort');
    expect(html).toContain('Name');
  });

  it('shows the empty message and no body when nothing matched', async () => {
    const html = await render(await DenseTable({ ...base, rows: [], shown: 0, total: 0 }));
    expect(html).toContain('No database instance in this region.');
    expect(html).not.toContain('<tbody');
    expect(html).not.toContain('Showing');
  });

  it('cannot be given a sort state without the link that makes it reachable', () => {
    // @ts-expect-error `sorting` carries the header link builder with it, so a state on its own is not a table.
    const broken: Parameters<typeof DenseTable>[0] = { ...base, sorting: { state } };
    expect(broken.sorting).toBeDefined();
  });
});
