// @vitest-environment jsdom
import { act, createElement, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// React 19's act() needs this flag, or the effect that reads the stored choice runs outside of it.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => (values ? `${key}:${Object.values(values).join()}` : key),
}));
// The real one needs a request locale; the panel only ever asks it for an `<a href>`.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => createElement('a', { href, ...rest }, children),
}));

const LINKS = [
  { subsection: 'search', href: '/c/x/eu-west-1/logs/search', label: 'Search', comingSoon: false },
  { subsection: 'volume', href: '/c/x/eu-west-1/logs/volume', label: 'Volume', comingSoon: false },
  { subsection: 'endpoints', href: '/c/x/eu-west-1/logs/endpoints', label: 'Endpoints', comingSoon: true },
];

const KEY = 'opswatch.sectionNav.collapsed';
const RAIL_KEY = 'opswatch.rail.collapsed';

let container: HTMLDivElement;
let root: Root;

/** A fresh module graph each time, because the remembered flag keeps one store per key per process. */
async function mount(): Promise<void> {
  vi.resetModules();
  const { SectionPanel } = (await import('@/components/monitoring/section-panel')) as unknown as {
    SectionPanel: ComponentType<{ sectionLabel: string; subsection: string; links: typeof LINKS }>;
  };
  await act(async () => {
    root.render(createElement(SectionPanel, { sectionLabel: 'Logs', subsection: 'search', links: LINKS }));
  });
}

async function mountRail(): Promise<void> {
  vi.resetModules();
  const { RailCollapseToggle } = (await import('@/components/rail-collapse')) as unknown as { RailCollapseToggle: ComponentType };
  await act(async () => {
    root.render(createElement(RailCollapseToggle));
  });
}

function railToggle(): HTMLButtonElement {
  return container.querySelector('button') as HTMLButtonElement;
}

function toggle(): HTMLButtonElement {
  return container.querySelector('nav > div > button') as HTMLButtonElement;
}

/** Collapsed means the words are for screen readers and hover only — never that an entry disappeared. */
function visibleNames(): string[] {
  return [...container.querySelectorAll('li > a, li > [aria-disabled]')]
    .map((entry) => {
      const copy = entry.cloneNode(true) as HTMLElement;
      for (const hidden of copy.querySelectorAll('[class*="sr-only"]')) hidden.remove();
      return copy.textContent?.trim() ?? '';
    })
    .filter((text) => text.length > 0);
}

beforeEach(() => {
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the main rail starts collapsed (UX-19)', () => {
  it('THE RULING: with nothing remembered the rail is down to its icons', async () => {
    await mountRail();
    expect(railToggle().getAttribute('aria-pressed')).toBe('true');
    // The control says what it will do, not what the rail is.
    expect(railToggle().textContent).toBe('rail.expand');
  });

  it('THE RULING: an operator who opened it once does not find it collapsed again', async () => {
    window.localStorage.setItem(RAIL_KEY, 'false');
    await mountRail();
    expect(railToggle().getAttribute('aria-pressed')).toBe('false');
    expect(railToggle().textContent).toBe('rail.collapse');
  });

  it('remembers being opened', async () => {
    await mountRail();
    await act(async () => railToggle().click());
    expect(window.localStorage.getItem(RAIL_KEY)).toBe('false');
    expect(railToggle().getAttribute('aria-pressed')).toBe('false');
  });
});

describe('the section menu keeps its words, and collapses on the control', () => {
  it('THE RULING: it opens as words — the rail beside it is the one that starts collapsed', async () => {
    await mount();
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
    expect(visibleNames()).toContain('Search');
    expect(visibleNames()).toContain('Volume');
    // The unbuilt sub-page says so in words rather than only to a screen reader.
    expect(visibleNames().join(' ')).toContain('sectionNav.comingSoon');
  });

  it('collapses to icons on the control, and every sub-page is still there', async () => {
    await mount();
    await act(async () => toggle().click());

    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelectorAll('li')).toHaveLength(3);
    expect(container.querySelectorAll('li [class*="sr-only"]')).toHaveLength(4); // three names and the badge
    expect(visibleNames()).toEqual([]);
    // The name is not lost: it is announced, and it is on hover.
    expect(container.querySelector('li a')?.getAttribute('title')).toBe('Search');
    expect(container.querySelector('li [class*="sr-only"]')?.textContent).toBe('Search');
    expect(window.localStorage.getItem(KEY)).toBe('true');
  });

  it('keeps the links usable while collapsed, which is what makes this a collapse and not a hide', async () => {
    window.localStorage.setItem(KEY, 'true');
    await mount();
    const hrefs = [...container.querySelectorAll('li a')].map((node) => node.getAttribute('href'));
    expect(hrefs).toEqual(['/c/x/eu-west-1/logs/search', '/c/x/eu-west-1/logs/volume']);
    expect(container.querySelector('li a')?.getAttribute('aria-current')).toBe('page');
    // The unbuilt one is still not a link, collapsed or not.
    expect(container.querySelector('li [aria-disabled="true"]')).not.toBeNull();
  });

  it('survives site data being blocked, because a menu is a convenience and not state', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('site data blocked');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('site data blocked');
    });
    await mount();
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
    // The choice still applies for this page view; it simply is not remembered.
    await act(async () => toggle().click());
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    getItem.mockRestore();
    setItem.mockRestore();
  });
});
