import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from '@/components/nav-items';

/**
 * The rail fits on the screen, whatever is in it.
 *
 * Adding one nav item pushed **Sign out** off the bottom: still in the DOM, still "visible" to a
 * query, and outside the viewport — so a click on it timed out. The cause is that a `flex-1` child of
 * a fixed-height column cannot shrink below its own content unless it is told it may.
 *
 * Worth a guard rather than a bug fixed once, because the failure scales with the product: every
 * section added from here makes it likelier, and it appears first on the shortest screen somebody
 * happens to be using rather than on the developer's.
 */

const sidebar = readFileSync(new URL('../../src/components/sidebar.tsx', import.meta.url), 'utf8');

describe('the navigation rail', () => {
  it('THE RULING: the list scrolls, so the controls beneath it cannot be pushed off the screen', () => {
    // `min-h-0` is the whole fix: without it `flex-1` is a floor, not a share.
    expect(sidebar).toContain('className="min-h-0 flex-1 overflow-y-auto"');
  });

  it('keeps the collapse toggle and sign out outside the scrolling area', () => {
    // Inside it they would scroll away, which is the same unreachability by another route.
    const panel = sidebar.slice(sidebar.indexOf('<nav aria-label={t(\'mainNavigation\')}'));
    const navEnd = panel.indexOf('</nav>');
    const after = panel.slice(navEnd);
    expect(after).toContain('<RailCollapseToggle />');
    expect(after).toContain('<SignOutForm');
  });

  it('has enough items for this to matter, which is why it is a guard', () => {
    // Not an assertion about a number anyone should keep: a reminder of why the class above is there.
    expect(NAV_ITEMS.length).toBeGreaterThanOrEqual(15);
  });
});
