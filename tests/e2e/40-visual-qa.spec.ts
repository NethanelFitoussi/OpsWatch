import { expect, test } from '@playwright/test';
import { MOTO_REGION, ensureMonitoringConnection, login } from './helpers';

/**
 * The visual defects that kept getting shipped, as a test.
 *
 * Three classes, each of which reached the running product at least once and none of which any other test
 * would have caught:
 *
 *   1. **A message key on the page.** next-intl renders a missing message as its key path, so a bad lookup
 *      reaches an operator as `Monitoring.metrics.cpuutilization` rather than as an error anywhere.
 *   2. **A clipped element.** A page that does not scroll sideways is not the same as a page where nothing
 *      is cut off: a grid item defaults to min-content width, and one unbreakable log group name used to
 *      widen a card past the viewport while the document stayed 360px.
 *   3. **A sideways-scrolling document**, which is the one the old tests did check.
 *
 * Every state is visited in both locales at both widths, because French is longer than English and the
 * defects above only appeared in one of the four combinations each time.
 */

const WIDTHS = [
  { name: 'wide', width: 1440, height: 1100 },
  { name: 'narrow', width: 390, height: 1400 },
] as const;

/** A message key that escaped, an element cut off inside its own card, a page that scrolls sideways. */
async function defectsOn(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const root = document.querySelector('main');
    if (root === null) return ['no main element'];
    if (/(Monitoring|Common|Docs|Sections)\.[A-Za-z]+\./.test(root.textContent ?? '')) out.push('a message key is rendered as text');
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    if (overflow > 0) out.push(`the document scrolls sideways by ${overflow}px`);
    for (const element of Array.from(root.querySelectorAll('*'))) {
      if (element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).overflowX === 'visible') {
        out.push(`clipped <${element.tagName.toLowerCase()}>: ${(element.textContent ?? '').slice(0, 40)}`);
      }
    }
    return out;
  });
}

let connectionId = '';

test.beforeEach(async ({ page }) => {
  await login(page);
  connectionId = await ensureMonitoringConnection(page);
});

test('THE RULING: Alarms and Logs render clean at both widths, in English and French', async ({ page }) => {
  const long = encodeURIComponent('opswatch-e2e-payments-business-transactions-failed-across-all-regions-critical');
  const pages = [
    ['alarms', `/c/${connectionId}/${MOTO_REGION}/alarms/list`],
    ['alarms filtered', `/c/${connectionId}/${MOTO_REGION}/alarms/list?state=ALARM`],
    ['alarms with no match', `/c/${connectionId}/${MOTO_REGION}/alarms/list?q=zzzz-no-such-alarm`],
    ['an alarm with a long name and no resource', `/c/${connectionId}/${MOTO_REGION}/alarms/list/${long}`],
    ['an alarm that is gone', `/c/${connectionId}/${MOTO_REGION}/alarms/list/does-not-exist`],
    ['logs', `/c/${connectionId}/${MOTO_REGION}/logs/search`],
    ['logs with a search restored from a link', `/c/${connectionId}/${MOTO_REGION}/logs/search?group=%2Fecs%2Fopswatch-web&q=gateway&level=error&limit=500&range=24h`],
    ['the searching-logs guide', '/docs/searching-logs'],
    ['the alarms guide', '/docs/alarms'],
  ] as const;

  const problems: string[] = [];
  for (const size of WIDTHS) {
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const locale of ['en', 'fr'] as const) {
      for (const [name, path] of pages) {
        await page.goto(`/${locale}${path}`);
        await expect(page.locator('main')).toBeVisible();
        for (const defect of await defectsOn(page)) problems.push(`${size.name} ${locale} — ${name}: ${defect}`);
      }
    }
  }
  expect(problems).toEqual([]);
});

test('THE RULING: the log lines sit above the fold on a phone, not under the sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1400 });
  await page.goto(`/en/c/${connectionId}/${MOTO_REGION}/logs/search`);
  await page.getByRole('checkbox', { name: /\/ecs\/opswatch-web/ }).check();
  await page.getByRole('button', { name: 'Search logs' }).click();
  const rows = page.getByRole('list', { name: 'Log lines' });
  await expect(rows).toBeVisible({ timeout: 20_000 });

  // In one column the grid follows DOM order, and the logs are what the page is for: they come straight
  // after the log-group picker, before the facets and the saved searches.
  const top = async (locator: ReturnType<typeof page.locator>) =>
    (await locator.first().evaluate((element) => element.getBoundingClientRect().top + window.scrollY)) as number;
  const logs = await top(rows);
  expect(logs, 'log lines above the facets').toBeLessThan(await top(page.getByText('Narrow these results')));
  expect(logs, 'log lines above the saved searches').toBeLessThan(await top(page.getByText('Save this search as')));

  // A results view still shows nothing cut off.
  await rows.getByRole('button').first().click();
  expect(await defectsOn(page)).toEqual([]);
});
