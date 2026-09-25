import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
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
  const base = `/c/${id}/${MOTO_REGION}`;
  /*
   * The estate an operator actually walks through, not a sample: every section's landing page, the two
   * detail pages this mission rebuilt, the settings a new installation starts in, and the documentation.
   * §V is a pass over the product, and a pass over four pages would be a claim rather than an audit.
   */
  const paths = [
    `${base}/overview/health`,
    `${base}/overview/problems`,
    `${base}/overview/insights`,
    `${base}/overview/report`,
    `${base}/alarms/list`,
    `${base}/alarms/list/opswatch-e2e-high-cpu`,
    `${base}/alarms/report`,
    `${base}/containers/services`,
    `${base}/containers/deployments`,
    `${base}/databases/instances`,
    `${base}/load-balancers/list`,
    `${base}/instances/list`,
    `${base}/redis/nodes`,
    `${base}/logs/search`,
    `${base}/logs/volume`,
    `${base}/logs/report`,
    `${base}/errors/groups`,
    '/settings',
    '/settings/backup',
    '/settings/notifications',
    `/accounts/${id}/collection`,
    '/docs',
    '/docs/alarms',
    '/docs/searching-logs',
  ];

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
