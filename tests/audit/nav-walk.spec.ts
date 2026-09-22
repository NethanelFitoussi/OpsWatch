import fs from 'node:fs';
import { test, type Page } from '@playwright/test';

/**
 * The acceptance walk: signs in and visits every navigation entry and every route the mission asks for,
 * recording what a user actually sees on each. It is how `docs/superpowers/audits/` is checked rather than
 * asserted, because a passing unit test says nothing about whether a page exists.
 *
 * It asserts nothing and fails nothing: it produces evidence. Run it against a stack that is already up:
 *
 *   docker compose -f docker-compose.test.yml up -d --build --wait
 *   npm run e2e                       # seeds the admin, the connections and moto
 *   npm run audit:nav                 # writes the report
 *
 * `OPSWATCH_AUDIT_OUT` chooses where the report goes.
 */
const OUT = process.env.OPSWATCH_AUDIT_OUT ?? 'audit-nav.json';

test.setTimeout(900_000);

const ADMIN = { email: 'admin@example.com', password: 'correct horse battery staple' };
const REPORT: Record<string, unknown>[] = [];

async function record(page: Page, label: string, path: string) {
  try {
    await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  } catch {
    /* recorded below as whatever the page ended up being */
  }
  const body = await page.locator('body').innerText().catch(() => '');
  const flat = body.replace(/\s+/g, ' ').trim();
  REPORT.push({
    label,
    requested: path,
    landedOn: (() => { try { return new URL(page.url()).pathname; } catch { return page.url(); } })(),
    comingSoon: /coming soon/i.test((await page.locator('main').first().innerText().catch(() => '')) || ''),
    notFound: /this page does not exist|404/i.test(flat),
    chars: flat.length,
    text: flat.slice(0, 200),
    // The <main> only, so the shell's nav (which carries its own 'Coming soon' badges) is not counted.
    main: (await page.locator('main').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim(),
  });
  fs.writeFileSync(OUT, JSON.stringify(REPORT, null, 1));
  console.log(`[${REPORT.length}] ${label} -> ${REPORT[REPORT.length - 1].landedOn}`);
}

test('walk every navigation entry', async ({ page }) => {
  await page.goto('/en/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/en\/accounts$/, { timeout: 20_000 });
  console.log('signed in');

  // The environments the API reports, which is exactly what `/c/<connectionId>/<region>` is built from.
  const environments = await page.request.get('/api/v1/environments').then((r) => r.json()).catch(() => ({ items: [] }));
  console.log('environments:', JSON.stringify(environments.items ?? []));
  const first = (environments.items ?? [])[0]?.id as string | undefined;
  const base = first ? `/en/c/${first.split(':')[0]}/${first.split(':').slice(1).join(':')}` : null;
  console.log('connection base:', base);

  for (const [label, path] of [['Accounts', '/en/accounts'], ['Settings', '/en/settings']] as const) {
    await record(page, label, path);
  }
  if (!base) return;

  const paths: [string, string][] = [
    ['Overview (default)', ''], ['Overview / Insights', '/overview/insights'], ['Overview / Audit', '/overview/audit'],
    ['Containers / Services', '/containers/services'], ['Containers / Report', '/containers/report'],
    ['Databases / Instances', '/databases/instances'], ['Databases / Queries', '/databases/queries'], ['Databases / Report', '/databases/report'],
    ['LBs / List', '/load-balancers/list'], ['LBs / Report', '/load-balancers/report'],
    ['Alarms / List', '/alarms/list'], ['Alarms / Report', '/alarms/report'],
    ['Logs / Search', '/logs/search'], ['Logs / Volume', '/logs/volume'], ['Logs / Endpoints', '/logs/endpoints'],
    ['Problems', '/overview/problems'], ['Health', '/overview/health'], ['Brief', '/overview/brief'],
    ['Errors', '/errors'], ['Services', '/services'], ['Incidents', '/incidents'], ['Synthetics', '/synthetics'],
    ['Alert rules', '/alerts'], ['SLOs', '/slos'], ['Deployments', '/deployments'], ['Repository', '/repository'],
    ['Ask OpsWatch', '/ai'], ['System status', '/system'],
  ];
  for (const [label, suffix] of paths) await record(page, label, `${base}${suffix}`);
});
