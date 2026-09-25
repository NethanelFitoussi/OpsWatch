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

test('THE RULING: a row leads with what is watched, and the AWS name is secondary', async ({ page }) => {
  await page.goto(alarms());
  const row = page.getByRole('listitem').filter({ hasText: 'opswatch-e2e-high-cpu' });
  // What, where and the condition — as sentences, before any AWS identifier.
  await expect(row).toContainText('CPU use is above its threshold');
  await expect(row).toContainText('ECS service web');
  await expect(row).toContainText('CPU utilization > 30%');

  // The identifier is still reachable, and it is behind the disclosure rather than being the title.
  const title = row.locator('p').first();
  await expect(title).not.toContainText('opswatch-e2e-high-cpu');
  await expect(row.getByRole('group')).toContainText('opswatch-e2e-high-cpu');
});

test('THE RULING: an Application Insights alarm is readable without decoding its name', async ({ page }) => {
  await page.goto(alarms());
  // The shape a real estate produces: no MetricName of its own, everything inside `Metrics[].MetricStat`,
  // and a name that is four AWS identifiers joined by slashes. The title has to come from the metric.
  const row = page.getByRole('listitem').filter({ hasText: 'ApplicationInsights/' });
  await expect(row).toContainText('CPU reservation is above its threshold');
  await expect(row).toContainText('ECS cluster opswatch-e2e');
  const title = row.locator('p').first();
  await expect(title).not.toContainText('ApplicationInsights/');
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

test('THE RULING: a healthy alarm never claims it crossed a threshold', async ({ page }) => {
  await page.goto(alarms());
  // The seeded RDS alarm is at OK. The family's sentence is written for the state the alarm exists to
  // catch, and printing it here made the list say the opposite of what the row's own colour said.
  const row = page.getByRole('listitem').filter({ hasText: 'opswatch-e2e-db-connections' });
  await expect(row).toContainText('Connections: within its threshold');
  await expect(row).not.toContainText('crossed');
  await expect(row).not.toContainText('above its threshold');

  // And one AWS could not evaluate says that, rather than either of the other two things.
  const unknown = page.getByRole('listitem').filter({ hasText: 'opswatch-e2e-cache-engine-cpu' });
  await expect(unknown).toContainText('AWS has no data for');
  await expect(unknown).not.toContainText('above its threshold');
});

test('THE RULING: the list is grouped by what needs attention, not by AWS service', async ({ page }) => {
  await page.goto(alarms());
  const main = page.locator('main');
  // The question the page is opened with is "what needs me". Grouping by service answers a different one.
  await expect(main.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Healthy' })).toBeVisible();
  // And the third state keeps its own section rather than being folded into either.
  await expect(main.getByRole('heading', { name: 'Not evaluated' })).toBeVisible();

  // The firing alarms come first, above the healthy ones.
  const headings = await main.getByRole('heading', { name: /Needs attention|Healthy/ }).allTextContents();
  expect(headings.indexOf('Needs attention')).toBeLessThan(headings.indexOf('Healthy'));

  // Service is still how the list is narrowed; it is no longer how it is arranged.
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
  // The datapoints themselves, labelled as what AWS saw when the state changed rather than as "current".
  await expect(main).toContainText('83, 91.5');
  await expect(main).toContainText('They are not the current value');
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

test('THE RULING: the detail explains what to check, and only links where it can prove the way', async ({ page }) => {
  await page.goto(`${alarms()}/${encodeURIComponent('opswatch-e2e-high-cpu')}`);
  const main = page.locator('main');

  // The page heading is not the AWS identifier.
  await expect(main.getByRole('heading', { level: 1 })).not.toContainText('opswatch-e2e-high-cpu');
  // A deterministic explanation of the metric family, written once rather than paraphrased per render.
  await expect(main).toContainText('What this measures');
  await expect(main).toContainText('Why it matters');
  // And the investigation, which is the reason an alarm in ALARM state is worth opening.
  await expect(main).toContainText('What to check');
  await expect(main.getByRole('listitem')).not.toHaveCount(0);
  // Only destinations OpsWatch can prove: an ECS alarm reaches the services it names.
  await expect(main.getByRole('link', { name: 'ECS services' }).first()).toBeVisible();
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
