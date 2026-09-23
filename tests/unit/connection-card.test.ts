// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => createElement('a', { href, ...rest }, children),
}));

const { ConnectionCard } = await import('@/components/connections/connection-card');

let container: HTMLDivElement;
let root: Root;

type Props = ComponentProps<typeof ConnectionCard>;

const BASE: Props = {
  integration: 'github',
  state: 'connected',
  provider: 'GitHub',
  tone: 'success',
  stateLabel: 'Connected',
  title: 'GitHub',
  href: '/settings/repositories',
  actionLabel: 'Manage',
};

function mount(props: Partial<Props> = {}): void {
  act(() => {
    root.render(createElement(ConnectionCard, { ...BASE, ...props }));
  });
}

function card(): HTMLElement {
  return container.querySelector('[data-integration]') as HTMLElement;
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('one card for every connection (UX-20)', () => {
  it('carries the provider, the scope and the measured state, for the cross-page checks', () => {
    mount();
    expect(card().dataset.integration).toBe('github');
    expect(card().dataset.scope).toBe('integration');
    expect(card().dataset.state).toBe('connected');
  });

  it('THE RULING: an account keeps its own vocabulary under its own scope', () => {
    // `ok` is an AWS permission test's word, not one of the four integration states. Letting both live in
    // one attribute would make "same state everywhere" unprovable.
    mount({ integration: 'aws', scope: 'connection', state: 'ok', stateLabel: 'Connected', title: 'Production' });
    expect(card().dataset.scope).toBe('connection');
    expect(card().dataset.state).toBe('ok');
  });

  it('THE RULING: the link says what following it does, not only where it goes', () => {
    mount();
    const link = card().querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/settings/repositories');
    // "GitHub" alone, in a page's list of links, does not say whether it connects or manages.
    expect(link.textContent).toContain('GitHub');
    expect(link.textContent).toContain('Manage');
    // The visible name is still the title, so the accessible name contains what is on screen (WCAG 2.5.3).
    expect(link.querySelector('.sr-only')?.textContent).toContain('Manage');
  });

  it('says the provider out loud, because the glyph that identifies it is decoration', () => {
    mount({ integration: 'aws', scope: 'connection', state: 'ok', title: 'Production', provider: 'AWS' });
    expect(card().textContent).toContain('AWS');
    expect(card().querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders the measured facts it is given, and nothing where there are none', () => {
    mount({ facts: [{ label: 'Regions', value: 'eu-west-1, us-east-1' }] });
    expect(card().querySelector('dt')?.textContent).toBe('Regions');
    expect(card().querySelector('dd')?.textContent).toBe('eu-west-1, us-east-1');

    act(() => root.render(createElement(ConnectionCard, BASE)));
    expect(card().querySelector('dl')).toBeNull();
  });

  it('THE RULING: with nowhere to go and nothing to explain, it offers no action at all', () => {
    // Google sign-in is configured in the environment. A row reading "Connect" under a card that already
    // says "Configured" would be the page contradicting itself.
    mount({ integration: 'google', href: null, title: 'Google sign-in' });
    expect(card().textContent).not.toContain('Manage');
    expect(card().querySelector('a')).toBeNull();
    // Not an empty row either: a blank strip of padding under the title is the same contradiction, drawn.
    expect(card().querySelectorAll('[data-slot="card-content"]')).toHaveLength(0);
  });

  it('explains itself when there is nowhere to go and a reason why', () => {
    mount({ href: null, hint: 'Not available in this build yet.' });
    expect(card().textContent).toContain('Not available in this build yet.');
  });

  it('keeps a second link out of the first one, which no browser would accept', () => {
    mount({ secondary: createElement('a', { href: '/getting-started/github' }, 'Read the guide') });
    const links = [...card().querySelectorAll('a')];
    expect(links).toHaveLength(2);
    // Neither is inside the other: the card-wide target is a pseudo-element, not a wrapper.
    expect(links[0].contains(links[1])).toBe(false);
  });
});
