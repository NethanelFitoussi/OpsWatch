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

test('THE RULING: Alarms, Logs and the reports render clean at both widths, in English and French', async ({ page }) => {
  const long = encodeURIComponent('opswatch-e2e-payments-business-transactions-failed-across-all-regions-critical');
  const insights = encodeURIComponent('ApplicationInsights/ApplicationInsights-ContainerInsights-ECS_CLUSTER-opswatch-e2e/AWS/ECS/CPUReservation/opswatch-e2e/');
  const pages = [
    ['alarms', `/c/${connectionId}/${MOTO_REGION}/alarms/list`],
    ['alarms filtered', `/c/${connectionId}/${MOTO_REGION}/alarms/list?state=ALARM`],
    ['alarms with no match', `/c/${connectionId}/${MOTO_REGION}/alarms/list?q=zzzz-no-such-alarm`],
    ['an alarm with a long name and no resource', `/c/${connectionId}/${MOTO_REGION}/alarms/list/${long}`],
    ['an alarm OpsWatch can explain', `/c/${connectionId}/${MOTO_REGION}/alarms/list/opswatch-e2e-high-cpu`],
    // The identifier a real estate produces: four AWS names joined by slashes, and nothing to break on.
    ['an Application Insights alarm', `/c/${connectionId}/${MOTO_REGION}/alarms/list/${insights}`],
    ['an alarm that is gone', `/c/${connectionId}/${MOTO_REGION}/alarms/list/does-not-exist`],
    ['logs', `/c/${connectionId}/${MOTO_REGION}/logs/search`],
    ['logs with a search restored from a link', `/c/${connectionId}/${MOTO_REGION}/logs/search?group=%2Fecs%2Fopswatch-web&q=gateway&level=error&limit=500&range=24h`],
    ['the estate report', `/c/${connectionId}/${MOTO_REGION}/overview/report`],
    ['the logs report', `/c/${connectionId}/${MOTO_REGION}/logs/report`],
    ['a section report', `/c/${connectionId}/${MOTO_REGION}/containers/report`],
    ['backup and restore', '/settings/backup'],
    ['managed collection', `/accounts/${connectionId}/collection`],
    ['the push-collection guide', '/docs/push-collection'],
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
  await page.getByRole('button', { name: 'Sources' }).click();
  await page.getByRole('checkbox', { name: /\/ecs\/opswatch-web/ }).check();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Search logs' }).click();
  const rows = page.getByRole('list', { name: 'Log lines' });
  await expect(rows).toBeVisible({ timeout: 20_000 });

  // In one column the grid follows DOM order, and the logs are what the page is for: they come straight
  // after the search row, before the facets. Nothing that is configuration sits between the two.
  const top = async (locator: ReturnType<typeof page.locator>) =>
    (await locator.first().evaluate((element) => element.getBoundingClientRect().top + window.scrollY)) as number;
  const logs = await top(rows);
  expect(logs, 'the search box above the log lines').toBeGreaterThan(await top(page.getByLabel('Find in logs')));
  expect(logs, 'log lines above the facets').toBeLessThan(await top(page.getByText('What came back')));

  // And the saved searches, which are a shortcut *to* a search, are out of the way once one has run.
  await expect(page.getByLabel('Save this search as')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Saved searches/ })).toBeVisible();

  // A results view still shows nothing cut off.
  await rows.getByRole('button').first().click();
  expect(await defectsOn(page)).toEqual([]);
});

/**
 * UX-7 — dark mode, verified rather than assumed.
 *
 * The tokens were there throughout and nobody had ever checked them end to end. Two failures are possible
 * and only one of them is a contrast failure: a panel that keeps a **light background and dark text** is
 * perfectly legible on its own and obviously wrong on a dark page, and no accessibility rule will say so.
 *
 * So this looks for the thing itself: a large surface that is still bright while the page is dark. The
 * contrast half is covered by the axe sweep, which now runs in both themes.
 */
test('THE RULING: nothing stays light when the page is dark', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  // next-themes reads this before the first paint, so the page renders dark rather than flipping into it.
  await page.addInitScript(() => window.localStorage.setItem('theme', 'dark'));

  const routes = [
    `/c/${connectionId}/${MOTO_REGION}/overview/health`,
    `/c/${connectionId}/${MOTO_REGION}/alarms/list`,
    `/c/${connectionId}/${MOTO_REGION}/alarms/list/opswatch-e2e-high-cpu`,
    `/c/${connectionId}/${MOTO_REGION}/logs/search`,
    `/c/${connectionId}/${MOTO_REGION}/overview/report`,
    '/settings',
    '/docs/alarms',
  ];

  const bright: string[] = [];
  for (const route of routes) {
    await page.goto(`/en${route}`);
    await expect(page.locator('main')).toBeVisible();
    // Guards the check itself: a theme that silently did not apply would make every assertion below pass.
    await expect(page.locator('html')).toHaveClass(/dark/);

    const found = await page.evaluate(() => {
      const luminance = (colour: string): number | null => {
        const parts = /rgba?\(([^)]+)\)/.exec(colour);
        if (parts === null) return null;
        const [r, g, b, a] = parts[1].split(',').map((one) => Number(one.trim()));
        // A transparent background is the one behind it, not a bright surface of its own.
        if (a !== undefined && a < 0.5) return null;
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      };
      const out: string[] = [];
      for (const element of Array.from(document.querySelectorAll('main *, header *'))) {
        const box = element.getBoundingClientRect();
        // Only surfaces big enough to be a panel: a bright chip or a badge is a deliberate accent.
        if (box.width < 200 || box.height < 60) continue;
        const value = luminance(getComputedStyle(element).backgroundColor);
        if (value !== null && value > 0.8) out.push(`<${element.tagName.toLowerCase()} class="${element.className}">`.slice(0, 80));
      }
      return out;
    });
    for (const one of found) bright.push(`${route}: ${one}`);
  }
  expect(bright).toEqual([]);
});
