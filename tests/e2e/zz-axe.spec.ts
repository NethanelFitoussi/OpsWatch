import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { estateRoutes } from './estate';
import { MOTO_REGION, ensureMonitoringConnection, login } from './helpers';

/**
 * UX-6, as a test rather than as a claim.
 *
 * axe-core against the pages this mission touched, at both widths and in both locales, for the rule
 * families a monitoring tool gets wrong: contrast (a status colour that reads as grey), ARIA misuse (a
 * filter chip that is a link claiming `aria-pressed`), names on controls, and heading order.
 */

const WIDTHS = [
  { name: 'wide', width: 1440, height: 1100 },
  { name: 'narrow', width: 390, height: 1400 },
] as const;

/**
 * UX-7, verified rather than asserted.
 *
 * Dark mode existed as tokens throughout and had never been checked end to end. The failure it hides is
 * exactly the one axe measures: a colour that passes 4.5:1 on white and disappears on near-black. So the
 * dark theme is swept too — at the wide width, since the narrow pass already proves the layout and it is
 * the palette that changes here, not the geometry.
 */
const THEMES = ['light', 'dark'] as const;

test('THE RULING: the product passes axe at both widths, in both locales, in both themes', async ({ page }) => {
  test.setTimeout(420_000);
  await login(page);
  const id = await ensureMonitoringConnection(page);
  const paths = estateRoutes(id, MOTO_REGION);

  const violations: string[] = [];
  for (const size of WIDTHS) {
    await page.setViewportSize({ width: size.width, height: size.height });
    // Dark mode is swept at the wide width only: the narrow pass proves the geometry, and what changes
    // between the themes is the palette.
    for (const theme of size.name === 'wide' ? THEMES : (['light'] as const)) {
      // next-themes reads this before the first paint, so the page renders in the theme rather than
      // flipping into it after axe has already looked.
      await page.addInitScript((value) => window.localStorage.setItem('theme', value), theme);
      for (const locale of ['en', 'fr'] as const) {
        for (const path of paths) {
          await page.goto(`/${locale}${path}`);
          await expect(page.locator('main')).toBeVisible();
          // Guards the sweep itself: a theme that silently did not apply would pass every check below.
          await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*\bdark\b).*$/);
          const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
          for (const one of result.violations) {
            violations.push(`${size.name} ${theme} ${locale} ${path} — ${one.id} (${one.nodes.length}): ${one.nodes[0]?.target.join(' ')}`);
          }
        }
      }
    }
  }
  expect(violations).toEqual([]);
});
