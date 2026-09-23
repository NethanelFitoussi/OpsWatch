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

function toggle(): HTMLButtonElement {
  return container.querySelector('nav > button') as HTMLButtonElement;
}

/** Collapsed means the words are for screen readers and hover only — never that an entry disappeared. */
function visibleNames(): string[] {
  return [...container.querySelectorAll('li > a, li > [aria-disabled]')]
    .map((entry) => {
      const copy = entry.cloneNode(true) as HTMLElement;
      for (const hidden of copy.querySelectorAll('.sr-only')) hidden.remove();
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

describe('the section menu collapses by default (UX-19)', () => {
  it('THE RULING: with nothing remembered it renders collapsed, and every sub-page is still there', async () => {
    await mount();
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelectorAll('li')).toHaveLength(3);
    // Three names, none of them shown as words.
    expect(container.querySelectorAll('li .sr-only')).toHaveLength(3);
    expect(visibleNames()).toEqual([]);
    // The name is not lost: it is announced, and it is on hover.
    expect(container.querySelector('li a')?.getAttribute('title')).toBe('Search');
    expect(container.querySelector('li .sr-only')?.textContent).toBe('Search');
  });

  it('keeps the links usable while collapsed, which is what makes this a collapse and not a hide', async () => {
    await mount();
    const hrefs = [...container.querySelectorAll('li a')].map((node) => node.getAttribute('href'));
    expect(hrefs).toEqual(['/c/x/eu-west-1/logs/search', '/c/x/eu-west-1/logs/volume']);
    expect(container.querySelector('li a')?.getAttribute('aria-current')).toBe('page');
    // The unbuilt one is still not a link, collapsed or not.
    expect(container.querySelector('li [aria-disabled="true"]')).not.toBeNull();
  });

  it('expands on the control, and remembers it for the next page', async () => {
    await mount();
    await act(async () => toggle().click());

    expect(toggle().getAttribute('aria-pressed')).toBe('false');
    expect(visibleNames()).toContain('Search');
    expect(window.localStorage.getItem(KEY)).toBe('false');
    // Expanded, the unbuilt sub-page says so in words rather than only to a screen reader.
    expect(visibleNames().join(' ')).toContain('sectionNav.comingSoon');
  });

  it('THE RULING: an operator who expanded it once does not find it collapsed again', async () => {
    window.localStorage.setItem(KEY, 'false');
    await mount();
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
    expect(visibleNames()).toContain('Volume');
  });

  it('survives site data being blocked, because the menu is a convenience and not state', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('site data blocked');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('site data blocked');
    });
    await mount();
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    // The choice still applies for this page view; it simply is not remembered.
    await act(async () => toggle().click());
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
    getItem.mockRestore();
    setItem.mockRestore();
  });
});
