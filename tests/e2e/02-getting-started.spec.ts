import { expect, test } from '@playwright/test';

test('the root redirects to English by default', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/en\/getting-started$/);
});

test('switching to French persists across visits', async ({ page }) => {
  await page.goto('/en/getting-started');
  // The button text is the locale code; `lang` identifies it without depending on text-transform.
  await page.getByRole('group', { name: 'Language' }).locator('button[lang="fr"]').click();
  await expect(page).toHaveURL(/\/fr\/getting-started$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Connectez votre compte AWS' })).toBeVisible();

  await page.goto('/');
  await expect(page).toHaveURL(/\/fr\/getting-started$/);
});

test('the diagram explains the focused node', async ({ page }) => {
  await page.goto('/en/getting-started');
  await page.getByRole('button', { name: 'Trust policy + ExternalId' }).focus();
  await expect(
    page.getByText("Who may assume the role: only OpsWatch's identity, and only when it presents this connection's ExternalId."),
  ).toBeVisible();
});

test('the guide shows the base identity policy and every service group', async ({ page }) => {
  await page.goto('/en/getting-started');
  await expect(page.getByText('arn:aws:iam::*:role/OpsWatchReadOnly-*').first()).toBeVisible();
  for (const name of ['Amazon ECS', 'Amazon RDS and Aurora', 'Performance Insights', 'CloudWatch Logs']) {
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }
});

test('step 0 explains both identities and answers the Identity Center question', async ({ page }) => {
  await page.goto('/en/getting-started');
  const step0 = page.locator('#step-0');
  await step0.getByRole('tab', { name: 'OpsWatch runs on AWS (ECS or EC2)' }).click();
  await expect(step0.getByText('ECS: open the task definition and note the', { exact: false })).toBeVisible();
  await expect(page.getByText('What about IAM Identity Center (SSO)?', { exact: true })).toBeVisible();
  await expect(step0.getByText('arn:aws:iam::*:role/OpsWatchReadOnly-*').first()).toBeVisible();
});

test('the guide shows the AWS service icons, with alt text only where the name is not written', async ({ page }) => {
  await page.goto('/en/getting-started');
  await expect(page.getByRole('img', { name: 'AWS CloudFormation' }).first()).toBeVisible();
  const ecsCard = page.locator('#services [data-slot="card"]').filter({ hasText: 'Amazon ECS' });
  await expect(ecsCard.locator('img[src="/aws-icons/Arch_Amazon-Elastic-Container-Service_48.svg"]')).toHaveAttribute('alt', '');
  const icon = await page.request.get('/aws-icons/Arch_Amazon-CloudWatch_48.svg');
  expect(icon.headers()['content-type']).toContain('image/svg+xml');
  expect((await page.request.get('/icon.svg')).ok()).toBe(true);
});
