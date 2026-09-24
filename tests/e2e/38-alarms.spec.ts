import { expect, test } from '@playwright/test';
import { MOTO_REGION, ensureMonitoringConnection, login, monitoringUrl } from './helpers';

let connectionId = '';

test.beforeEach(async ({ page }) => {
  await login(page);
  connectionId = await ensureMonitoringConnection(page);
});

const alarms = () => monitoringUrl(connectionId, 'alarms', 'list');

test('THE RULING: the page answers "are my alarms OK" before anything else', async ({ page }) => {
  await page.goto(alarms());
  const main = page.locator('main');

  // Every state is counted, and the count is beside the word rather than in a tooltip.
  await expect(main).toContainText(/In alarm\s*\d+/);
  await expect(main).toContainText(/OK\s*\d+/);
  await expect(main).toContainText(/Insufficient data\s*\d+/);
});

test('THE RULING: an alarm AWS could not evaluate is never counted as OK', async ({ page }) => {
  await page.goto(alarms());
  // The seeded ElastiCache alarm has no datapoints, so AWS leaves it INSUFFICIENT_DATA.
  await page.getByRole('link', { name: /^Insufficient data/ }).click();
  await expect(page).toHaveURL(/state=INSUFFICIENT_DATA/);
  await expect(page.locator('main')).toContainText('opswatch-e2e-cache-engine-cpu');

  // And it is absent from OK, which is the count a dashboard is most tempted to inflate.
  await page.getByRole('link', { name: /^OK/ }).click();
  await expect(page.locator('main')).not.toContainText('opswatch-e2e-cache-engine-cpu');
});

test('a row leads with what is watched, and keeps the AWS name', async ({ page }) => {
  await page.goto(alarms());
  const row = page.getByRole('listitem').filter({ hasText: 'opswatch-e2e-high-cpu' });
  // "CPU on web", not "opswatch-e2e-high-cpu".
  await expect(row).toContainText(/on web/);
  await expect(row).toContainText('ECS');
  // The AWS name is still there, because that is what a runbook and the console say.
  await expect(row).toContainText('opswatch-e2e-high-cpu');
});

test('THE RULING: the figure shown is what AWS reported, never an invented current value', async ({ page }) => {
  await page.goto(alarms());
  const row = page.getByRole('listitem').filter({ hasText: 'payments-business-transactions' });
  // The seeded reason quotes 83.0; the label says who measured it and when.
  await expect(row).toContainText('AWS reported');
  await expect(row).toContainText('83');

  // The ECS alarm's reason quotes no datapoint, so no figure is shown at all rather than a zero.
  const noFigure = page.getByRole('listitem').filter({ hasText: 'opswatch-e2e-high-cpu' });
  await expect(noFigure).not.toContainText('AWS reported');
});

test('alarms are grouped by the service their namespace names, not by their own name', async ({ page }) => {
  await page.goto(alarms());
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'ECS' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Databases' })).toBeVisible();
  // `Acme/Custom` is a namespace OpsWatch does not know, and it says so rather than guessing.
  await expect(main.getByRole('heading', { name: 'Other' })).toBeVisible();

  await page.locator('main').getByRole('link', { name: 'Databases', exact: true }).click();
  await expect(page).toHaveURL(/svc=rds/);
  await expect(page.locator('main')).toContainText('opswatch-e2e-db-connections');
  await expect(page.locator('main')).not.toContainText('opswatch-e2e-high-cpu');
});

test('a filtered view is a link, so it can be shared and the back button works', async ({ page }) => {
  await page.goto(alarms());
  await page.getByRole('link', { name: /^In alarm/ }).click();
  await expect(page).toHaveURL(/state=ALARM/);
  await page.goBack();
  await expect(page).not.toHaveURL(/state=ALARM/);
  await expect(page.locator('main')).toContainText('opswatch-e2e-db-connections');
});

test('the page explains how an alarm differs from a problem, without a wall of text', async ({ page }) => {
  await page.goto(alarms());
  await expect(page.locator('main')).toContainText('A CloudWatch alarm is a rule you wrote in AWS');
  await page.getByRole('link', { name: 'Alarms and problems' }).first().click();
  await expect(page).toHaveURL(/\/docs\/alarms$/);
});

test('THE RULING: an alarm detail explains the condition, and admits what it cannot show', async ({ page }) => {
  await page.goto(`${alarms()}/${encodeURIComponent('opswatch-e2e-payments-business-transactions-failed-across-all-regions-critical')}`);
  const main = page.locator('main');

  await expect(main).toContainText('The condition');
  await expect(main).toContainText('2 of 2');
  await expect(main).toContainText('notBreaching');
  // Whoever wrote the alarm left a description; it is the best explanation on the page.
  await expect(main).toContainText('Raised by the payments team');
  // AWS's sentence is kept but not led with.
  await expect(main).toContainText('AWS saw 83 against a threshold of ≥ 5');
  await expect(main.getByText('What AWS actually wrote')).toBeVisible();

  // No empty timeline: the permission is not granted and the page says which one.
  await expect(main).toContainText('cloudwatch:DescribeAlarmHistory');
});

test('an alarm with no resolvable resource says so rather than showing an empty box', async ({ page }) => {
  await page.goto(`${alarms()}/${encodeURIComponent('opswatch-e2e-payments-business-transactions-failed-across-all-regions-critical')}`);
  const main = page.locator('main');
  // A sentence, not "It watches X on no resource AWS names." — the slot where a name goes stays empty.
  await expect(main).toContainText('The alarm names no resource');
  await expect(main).not.toContainText(/ on no resource/);
});

test('THE RULING: a metric OpsWatch has no phrase for is shown by its AWS name, never as a message key', async ({ page }) => {
  for (const url of [
    alarms(),
    `${alarms()}/${encodeURIComponent('opswatch-e2e-payments-business-transactions-failed-across-all-regions-critical')}`,
  ]) {
    await page.goto(url);
    const main = page.locator('main');
    // next-intl renders a missing message as its key path, so a bad lookup reaches the operator as
    // `Monitoring.metrics.cpuutilization`. Nothing on either page may look like one.
    await expect(main).not.toContainText(/Monitoring\.[A-Za-z]+\./);
    await expect(main).not.toContainText(/Common\.[A-Za-z]+\./);
  }
  // The custom metric keeps its real AWS spelling, which is searchable in the console.
  await expect(page.locator('main')).toContainText('BusinessTransactionsFailedPerMinuteAcrossAllRegions');
});

test('a metric OpsWatch does name reads as a phrase, in both locales', async ({ page }) => {
  await page.goto(`${alarms()}/${encodeURIComponent('opswatch-e2e-high-cpu')}`);
  await expect(page.locator('main')).toContainText('CPU utilization');
  await page.goto(`/fr/c/${connectionId}/${MOTO_REGION}/alarms/list/${encodeURIComponent('opswatch-e2e-high-cpu')}`);
  await expect(page.locator('main')).toContainText('Utilisation CPU');
  await expect(page.locator('main')).not.toContainText(/Monitoring\.[A-Za-z]+\./);
});

test('an alarm that no longer exists says so instead of failing', async ({ page }) => {
  await page.goto(`${alarms()}/${encodeURIComponent('does-not-exist')}`);
  await expect(page.locator('main')).toContainText('no longer reports an alarm called does-not-exist');
});

test('the detail links to the problem this alarm raised, and calls it a problem', async ({ page }) => {
  await page.goto(`${alarms()}/${encodeURIComponent('opswatch-e2e-high-cpu')}`);
  const related = page.locator('main').getByRole('link', { name: 'Open the problem this alarm raised' });
  if ((await related.count()) > 0) {
    await related.click();
    await expect(page).toHaveURL(/\/overview\/problems\/[0-9a-f]+$/);
  } else {
    await expect(page.locator('main')).toContainText('No OpsWatch problem is open for this alarm');
  }
});

test('alarms render at 360px without horizontal overflow, in English and French', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const locale of ['en', 'fr'] as const) {
    await page.goto(`/${locale}/c/${connectionId}/${MOTO_REGION}/alarms/list`);
    await expect(page.locator('main')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, locale).toBeLessThanOrEqual(0);

    // The page not scrolling sideways is not the same as nothing being cut off: a long custom metric name
    // is one unbroken token, and it was clipped inside its own card while the document stayed 360px wide.
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll('main *')]
        .filter((element) => element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).overflowX === 'visible')
        .map((element) => element.textContent?.slice(0, 40) ?? ''),
    );
    expect(clipped, locale).toEqual([]);
  }
});
