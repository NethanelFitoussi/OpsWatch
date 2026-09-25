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

test('THE RULING: the pages this mission rebuilt pass axe at both widths, in both locales', async ({ page }) => {
  test.setTimeout(240_000);
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
    for (const locale of ['en', 'fr'] as const) {
      for (const path of paths) {
        await page.goto(`/${locale}${path}`);
        await expect(page.locator('main')).toBeVisible();
        const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        for (const one of result.violations) {
          violations.push(`${size.name} ${locale} ${path} — ${one.id} (${one.nodes.length}): ${one.nodes[0]?.target.join(' ')}`);
        }
      }
    }
  }
  expect(violations).toEqual([]);
});
