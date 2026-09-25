import { test } from '@playwright/test';
import { MOTO_REGION, ensureMonitoringConnection, login } from './helpers';

/**
 * Not an assertion — a camera.
 *
 * The acceptance for the Alarms and Logs work is somebody looking at the result, so this captures the
 * states that matter at both widths and leaves them in `test-results/shots`. It is excluded from the suite by
 * its filename only when run with a grep; ordinarily it is cheap and harmless.
 */

const WIDTHS = [
  { name: 'wide', width: 1440, height: 1200 },
  { name: 'phone', width: 390, height: 1400 },
] as const;

test('shots', async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  const id = await ensureMonitoringConnection(page);
  const base = `/en/c/${id}/${MOTO_REGION}`;
  const long = encodeURIComponent('opswatch-e2e-payments-business-transactions-failed-across-all-regions-critical');

  for (const size of WIDTHS) {
    await page.setViewportSize({ width: size.width, height: size.height });
    const shot = (name: string) => page.screenshot({ path: `test-results/shots/${size.name}-${name}.png`, fullPage: true });

    for (const [name, path] of [
      ['alarms-list', `${base}/alarms/list`],
      ['alarm-detail', `${base}/alarms/list/opswatch-e2e-high-cpu`],
      ['alarm-detail-custom', `${base}/alarms/list/${long}`],
      ['report', `${base}/overview/report`],
      ['logs-initial', `${base}/logs/search`],
    ] as const) {
      await page.goto(path);
      await page.locator('main').waitFor();
      await page.waitForTimeout(1500);
      await shot(name);
    }

    // The source picker, open.
    await page.getByRole('button', { name: 'Sources' }).click();
    await page.waitForTimeout(400);
    await shot('logs-sources');

    // A search, run.
    await page.getByRole('checkbox', { name: /\/ecs\/opswatch-web/ }).check();
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Search logs' }).click();
    await page.getByRole('list', { name: 'Log lines' }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(500);
    await shot('logs-results');

    // The saved searches, reopened by hand once a search has run.
    await page.getByRole('button', { name: /Saved searches/ }).click();
    await page.waitForTimeout(300);
    await shot('logs-saved');
  }
});
