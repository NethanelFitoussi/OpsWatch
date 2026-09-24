import { expect, test } from '@playwright/test';
import { MOTO_REGION, ensureMonitoringConnection, login } from './helpers';

/**
 * Saved log searches.
 *
 * A saved search is a shortcut back to a search: it restores the text, the level, the line count, the
 * range and the log groups, and it does so by navigating to the URL it was saved from. Nothing here runs
 * on its own and nothing leaves the instance.
 *
 * Cross-user isolation is proved in `tests/unit/saved-searches.test.ts` against the store, because this
 * installation has one administrator and there is no second account to sign in as.
 */

let connectionId = '';

test.beforeEach(async ({ page }) => {
  await login(page);
  connectionId = await ensureMonitoringConnection(page);
});

const logs = () => `/en/c/${connectionId}/${MOTO_REGION}/logs/search`;

/** Removes every saved search, so a rerun starts from the same place as a first run. */
async function clearSaved(page: import('@playwright/test').Page) {
  await page.goto(logs());
  for (;;) {
    const remove = page.getByRole('button', { name: /^Delete “/ }).first();
    if ((await remove.count()) === 0) break;
    await remove.click();
    await expect(page.getByText('You have not saved a search in this environment yet.')).toBeVisible().catch(() => undefined);
  }
}

test('a search is saved, loaded, renamed, copied and deleted', async ({ page }) => {
  await clearSaved(page);
  await page.goto(logs());
  await expect(page.getByText('You have not saved a search in this environment yet.')).toBeVisible();

  // Saving needs something to search, and says so rather than storing an empty search.
  await expect(page.getByText('Choose at least one log group before saving.')).toBeVisible();

  await page.getByRole('checkbox', { name: /\/ecs\/opswatch-web/ }).check();
  await page.getByLabel('Find in logs').fill('gateway');
  await page.getByLabel('Level').selectOption('error');
  await page.getByLabel('Save this search as').fill('Payments errors');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Payments errors' })).toBeVisible();

  // Loading it is a navigation, so the URL it restores is the URL it was saved from.
  await page.goto(logs());
  await page.getByRole('link', { name: 'Payments errors' }).click();
  await expect(page).toHaveURL(/q=gateway/);
  await expect(page).toHaveURL(/level=error/);
  await expect(page).toHaveURL(/group=%2Fecs%2Fopswatch-web/);
  await expect(page.getByLabel('Find in logs')).toHaveValue('gateway');
  await expect(page.getByLabel('Level')).toHaveValue('error');
  await expect(page.getByRole('checkbox', { name: /\/ecs\/opswatch-web/ })).toBeChecked();

  // A copy takes a free name rather than failing on the one that is taken.
  await page.getByRole('button', { name: 'Make a copy of “Payments errors”' }).click();
  await expect(page.getByRole('link', { name: 'Payments errors (2)' })).toBeVisible();

  // Renaming changes the name and nothing else.
  await page.getByRole('button', { name: 'Rename “Payments errors (2)”' }).click();
  await page.getByLabel('New name').fill('Gateway timeouts');
  await page.getByRole('button', { name: 'Save', exact: true }).nth(1).click();
  await expect(page.getByRole('link', { name: 'Gateway timeouts' })).toBeVisible();
  await page.getByRole('link', { name: 'Gateway timeouts' }).click();
  await expect(page.getByLabel('Find in logs')).toHaveValue('gateway');

  await page.goto(logs());
  await page.getByRole('button', { name: 'Delete “Gateway timeouts”' }).click();
  await expect(page.getByRole('link', { name: 'Gateway timeouts' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Payments errors' })).toBeVisible();
});

test('THE RULING: two saved searches cannot share a name, and the refusal says so', async ({ page }) => {
  await clearSaved(page);
  await page.goto(logs());
  await page.getByRole('checkbox', { name: /\/ecs\/opswatch-web/ }).check();
  await page.getByLabel('Save this search as').fill('Only one');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Only one' })).toBeVisible();

  await page.getByLabel('Save this search as').fill('Only one');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('You already have a saved search with that name.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Only one' })).toHaveCount(1);

  await page.getByLabel('Save this search as').fill('   ');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Give the search a name.')).toBeVisible();
});

test('THE RULING: only a relative range is stored, so a saved search still means something tomorrow', async ({ page }) => {
  await clearSaved(page);
  await page.goto(logs());
  await page.getByRole('checkbox', { name: /\/ecs\/opswatch-web/ }).check();
  await page.getByLabel('Time range').selectOption('24h');
  await expect(page).toHaveURL(/range=24h/);
  await page.getByLabel('Save this search as').fill('Last day');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await page.goto(logs());
  const href = await page.getByRole('link', { name: 'Last day' }).getAttribute('href');
  expect(href).toContain('range=24h');
  // No absolute window anywhere in what was stored: it would be a bookmark to a moment that never returns.
  expect(href).not.toMatch(/start|end|from=|to=|\d{10,}/);
});

test('saving needs a session, and an anonymous post changes nothing', async ({ page, context, playwright, baseURL }) => {
  await clearSaved(page);
  await page.goto(logs());
  await page.getByRole('checkbox', { name: /\/ecs\/opswatch-web/ }).check();
  await page.getByLabel('Save this search as').fill('Mine');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Mine' })).toBeVisible();

  // Signed out, the page itself is not reachable, so neither is anything on it.
  await context.clearCookies();
  await page.goto(logs());
  await expect(page).toHaveURL(/\/en\/login$/);

  // And a request with no session at all is refused rather than acted on.
  const anonymous = await playwright.request.newContext({ baseURL });
  const response = await anonymous.post(logs(), {
    form: { name: 'Injected', q: '', level: '', limit: '100', range: '1h', group: '/ecs/opswatch-web' },
    headers: { origin: baseURL as string },
  });
  // Without a session the request never reaches the action: it lands on the login page, which is neither
  // the logs page nor a saved search.
  expect(response.url()).toMatch(/\/en\/login/);
  await anonymous.dispose();

  await login(page);
  await page.goto(logs());
  await expect(page.getByRole('link', { name: 'Injected' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Mine' })).toBeVisible();
});
