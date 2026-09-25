import { expect, test } from '@playwright/test';
import { estateRoutes } from './estate';
import { MOTO_REGION, ensureMonitoringConnection, login } from './helpers';

/**
 * UX-3, as a sweep rather than a page-by-page habit (§U).
 *
 * Individual specs each check their own page at 360px, which means a page nobody wrote that line for is
 * never checked at all — and 360px is the width the smallest phones still in use actually have. A
 * layout that overflows there does not degrade gracefully: the operator gets a page that slides
 * sideways under their thumb, with a column of figures off the edge they may never find.
 *
 * Two different failures are measured, because one hides the other:
 *
 *   1. the **page** scrolls sideways, which is the one anybody notices; and
 *   2. an **element** is wider than the viewport while the page does not scroll, because something
 *      above it clips the overflow. Nothing looks wrong, and the right-hand end of that element is
 *      simply gone.
 *
 * A region that scrolls sideways *on purpose* — a wide table inside its own scroll container — is not
 * either of those, and is exempt: `scrollable-regions.test.ts` holds those to being keyboard-reachable.
 */

const WIDTH = 360;

test('THE RULING: nothing overflows 360px, in either language', async ({ page }) => {
  test.setTimeout(300_000);
  await login(page);
  const id = await ensureMonitoringConnection(page);
  const paths = estateRoutes(id, MOTO_REGION);

  await page.setViewportSize({ width: WIDTH, height: 800 });
  const findings: string[] = [];

  for (const locale of ['en', 'fr'] as const) {
    for (const path of paths) {
      await page.goto(`/${locale}${path}`);
      await expect(page.locator('main')).toBeVisible();

      const result = await page.evaluate((width) => {
        const doc = document.documentElement;
        const page = doc.scrollWidth - doc.clientWidth;
        // Deliberate sideways scrollers, and anything inside one, are doing their job.
        const scrollers = [...document.querySelectorAll('*')].filter((node) => {
          const overflow = getComputedStyle(node).overflowX;
          return overflow === 'auto' || overflow === 'scroll';
        });
        const wide = [...document.querySelectorAll('body *')]
          .filter((node) => {
            if (scrollers.some((scroller) => scroller === node || scroller.contains(node))) return false;
            const box = node.getBoundingClientRect();
            // A hidden element has no box; half a pixel is a rounding artefact, not a layout fault.
            return box.width > 0 && box.right > width + 1;
          })
          .slice(0, 3)
          .map((node) => `${node.tagName.toLowerCase()}.${[...node.classList].slice(0, 2).join('.')}`);
        return { page, wide };
      }, WIDTH);

      if (result.page > 0) findings.push(`${locale} ${path} — the page scrolls sideways by ${result.page}px`);
      if (result.wide.length > 0) findings.push(`${locale} ${path} — wider than the screen: ${result.wide.join(', ')}`);
    }
  }

  expect(findings).toEqual([]);
});
