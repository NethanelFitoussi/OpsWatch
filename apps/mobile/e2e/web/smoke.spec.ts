/**
 * Demo-mode tour of the web export at every configured device size. Each step asserts meaningful content and saves a
 * screenshot to test-results/screens/<project>/ for visual QA (clipping, safe areas, dark mode, tablets).
 */
import { expect, test, type Page } from '@playwright/test';

async function shot(page: Page, name: string) {
  const project = test.info().project.name;
  await page.screenshot({ path: `test-results/screens/${project}/${name}.png`, fullPage: false });
}

async function startDemo(page: Page) {
  await page.goto('/');
  await page.getByTestId('start-demo').click();
  await expect(page.getByTestId('status-title')).toHaveText(/Degraded/);
}

test('connect screen, then demo home answers "is production healthy?"', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await expect(page.getByTestId('connect-screen')).toBeVisible();
  await shot(page, '01-connect');
  await page.getByTestId('server-url').fill('http://ops.example.com');
  await page.getByTestId('test-connection').click();
  await expect(page.getByText(/OpsWatch requires HTTPS/)).toBeVisible();
  await shot(page, '02-connect-https-error');
  await page.getByTestId('start-demo').click();
  await expect(page.getByTestId('status-title')).toHaveText(/Degraded/);
  await expect(page.getByTestId('demo-banner')).toBeVisible();
  await expect(page.getByTestId('action-verdict')).toContainText('2 critical');
  await shot(page, '03-home');
  expect(errors).toEqual([]);
});

test('home → most important problem → investigation → evidence', async ({ page }) => {
  await startDemo(page);
  await page.getByTestId('investigate-top-problem').click();
  await expect(page.getByTestId('problem-title')).toHaveText('checkout-api is returning HTTP 5xx');
  await shot(page, '04-problem');
  await page.getByTestId('evidence-section-hypothesis').scrollIntoViewIfNeeded();
  await shot(page, '05-problem-hypotheses');
  await page.goto('/investigations/inv-checkout-5xx');
  await expect(page.getByText(/Checkout 5xx and database/).first()).toBeVisible();
  await shot(page, '06-investigation');
  await page.goto('/evidence/ev-repo-checkout-pricing');
  await expect(page.getByText('src/pricing/cart-pricing.ts').first()).toBeVisible();
  await shot(page, '07-evidence');
});

test('tabs: problems, alerts, services, more', async ({ page }) => {
  await startDemo(page);
  await page.getByTestId('tab-problems').click();
  await expect(page.getByText('checkout-api is returning HTTP 5xx').first()).toBeVisible();
  await shot(page, '08-problems');
  await page.getByTestId('tab-alerts').click();
  await expect(page.getByText('checkout-5xx-high').first()).toBeVisible();
  await shot(page, '09-alerts');
  await page.getByTestId('tab-services').click();
  await expect(page.getByText('checkout-api').first()).toBeVisible();
  await shot(page, '10-services');
  await page.getByTestId('tab-more').click();
  await expect(page.getByTestId('more-screen')).toBeVisible();
  await shot(page, '11-more');
});

test('details: error, service, alert, incident, synthetic, SLO, deployment, infrastructure, logs', async ({ page }) => {
  await startDemo(page);
  const visit = async (path: string, text: string | RegExp, name: string) => {
    await page.goto(path);
    await expect(page.getByText(text).first()).toBeVisible();
    await shot(page, name);
  };
  await visit('/errors/err-checkout-currency', 'priceCart.lines.map', '12-error');
  await visit('/services/svc-checkout-api', 'Prices carts and takes payments.', '13-service');
  await visit('/alerts/al-checkout-5xx', 'checkout-5xx-high', '14-alert');
  await visit('/incidents/inc-2291', /INC-2291/, '15-incident');
  await visit('/synthetics', 'Checkout API', '16-synthetics');
  await visit('/synthetics/syn-checkout-api', 'Checkout API', '17-synthetic');
  await visit('/slos/slo-checkout-availability', 'Checkout availability', '18-slo');
  await visit('/deployments/dep-checkout-2140', /v2\.14\.0/, '19-deployment');
  await visit('/infrastructure', 'aurora-main-instance-1', '20-infrastructure');
  await visit('/brief', /Production/, '21-brief');
  await page.goto('/logs');
  await page.getByTestId('logs-search-input').fill('TypeError');
  await page.getByTestId('logs-search-submit').click();
  await expect(page.getByText(/Cannot read properties/).first()).toBeVisible();
  await shot(page, '22-logs');
});

test('ask OpsWatch, search and settings', async ({ page }) => {
  await startDemo(page);
  await page.goto('/ask');
  await page.getByText('Why is production unhealthy?').first().click();
  await expect(page.getByText(/AI-generated/).first()).toBeVisible();
  await shot(page, '23-ask');
  await page.goto('/search');
  await page.getByTestId('search-input').fill('checkout');
  await expect(page.getByText('checkout-api is returning HTTP 5xx').first()).toBeVisible();
  await shot(page, '24-search');
  await page.goto('/settings');
  await expect(page.getByText(/demo@opswatch.dev/).first()).toBeVisible();
  await shot(page, '25-settings');
});

test('a deep link opens the object, and an unknown one lands somewhere with a way out', async ({ page }) => {
  await startDemo(page);
  await page.goto('/problems/prb-redis-latency');
  await expect(page.getByText('sessions-redis latency elevated').first()).toBeVisible();

  // An unknown path must never strand someone: the app says what happened and offers the way back. This used to be
  // asserted against a phrase that exists in no catalogue, so the assertion could only ever pass by falling through
  // to the other branch — which is to say it asserted nothing.
  await page.goto('/definitely/not/a/route');
  await expect(page.getByText('This no longer exists on the server.')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Home' }).click();
  await expect(page.getByTestId('status-title')).toBeVisible({ timeout: 10_000 });
});
