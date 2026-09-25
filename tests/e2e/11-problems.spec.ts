import { expect, test } from '@playwright/test';
import { briefSchema, healthSchema, investigationSchema, pageSchema, problemSummarySchema } from '@opswatch/contract';
import { MOTO_REGION, ensureMonitoringConnection, login, rscHeaders } from './helpers';

let connectionId = '';

test.beforeEach(async ({ page }) => {
  await login(page);
  connectionId = await ensureMonitoringConnection(page);
});

const problemsUrl = () => `/en/c/${connectionId}/${MOTO_REGION}/overview/problems`;

test('the overview opens on the Morning brief, as the section default', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/${MOTO_REGION}/overview`);
  await expect(page).toHaveURL(new RegExp('/overview/brief$'));
  // The page's name is its h1. It used to be an h2 as well, on a card that repeated the header.
  await expect(page.getByRole('heading', { level: 1, name: 'Morning brief' })).toBeVisible();
});

test('Problems, Health and the brief are all real pages', async ({ page }) => {
  for (const [subsection, heading] of [['problems', 'Problems'], ['health', 'Health'], ['brief', 'Morning brief']] as const) {
    await page.goto(`/en/c/${connectionId}/${MOTO_REGION}/overview/${subsection}`);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  }
});

test('THE RULING: Health never reports production healthy on a reading it has not taken', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/${MOTO_REGION}/overview/health`);
  const main = await page.locator('main').innerText();
  // A verdict and an unread family can both be on the page — that is the honest combination, and saying
  // so per family is the point of the page. What may never happen is the two together in the one shape
  // that would be a lie: an overall "Healthy" while something was never read.
  const gaps = /Cannot be determined|has not finished its first check/.test(main);
  const headline = page.locator('main h2, main p').filter({ hasText: /^(Healthy|Degraded|Critical|Unknown)$/ }).first();
  if (gaps && (await headline.count()) > 0) {
    await expect(headline).not.toHaveText('Healthy');
  }
  // And it always reaches one of the two: a page that says neither has told the reader nothing.
  expect(/Healthy|Degraded|Critical|Cannot be determined|has not finished its first check/.test(main)).toBe(true);
});

test('GET /api/v1/health and /brief answer the shapes every client parses', async ({ page }) => {
  const env = `${connectionId}:${MOTO_REGION}`;
  const health = await page.request.get(`/api/v1/health?env=${env}`);
  expect(health.status(), await health.text()).toBe(200);
  healthSchema.parse(await health.json());

  const brief = await page.request.get(`/api/v1/brief?env=${env}`);
  expect(brief.status(), await brief.text()).toBe(200);
  const parsed = briefSchema.parse(await brief.json());
  expect(parsed.period.to).toBeGreaterThan(parsed.period.from);
});

test('Problems says which of its two empty states applies, never the wrong one', async ({ page }) => {
  await page.goto(problemsUrl());
  const body = await page.locator('main').innerText();
  // Three legitimate states, and the page must be in exactly one: it has rows, it has looked and found
  // nothing, or it has not looked yet. "Nothing is wrong" when nobody has looked is the one lie that matters.
  const listed = (await page.locator('main li').count()) > 0;
  const looked = body.includes('Nothing is wrong in this environment');
  const waiting = body.includes('has not finished its first check');
  expect([listed, looked, waiting].filter(Boolean)).toHaveLength(1);
});

test('the overview menu links every page it names, with none left disabled', async ({ page }) => {
  await page.goto(problemsUrl());
  const nav = page.getByRole('navigation', { name: 'Overview pages' });
  // Every Overview sub-page is built now, Checkup included, so every entry is a link.
  for (const label of ['Morning brief', 'Health', 'Problems', 'Insights', 'Checkup']) {
    await expect(nav.getByRole('link', { name: label })).toBeVisible();
  }
  await expect(nav.locator('[aria-disabled="true"]')).toHaveCount(0);
});

test('GET /api/v1/problems answers the shape every client parses', async ({ page }) => {
  const response = await page.request.get(`/api/v1/problems?env=${connectionId}:${MOTO_REGION}`);
  expect(response.status(), await response.text()).toBe(200);
  const page1 = pageSchema(problemSummarySchema).parse(await response.json());
  expect(Array.isArray(page1.items)).toBe(true);
  // Cursored, and honest about there being no more.
  expect(page1.nextCursor === null || typeof page1.nextCursor === 'string').toBe(true);
});

test('the problems endpoint refuses an environment this instance does not have', async ({ page }) => {
  const missing = await page.request.get('/api/v1/problems?env=deadbeefcafe:us-east-1');
  // "Nothing is wrong there" and "that is not one of mine" are different answers.
  expect(missing.status()).toBe(404);
  const malformed = await page.request.get('/api/v1/problems?env=not-an-environment');
  expect(malformed.status()).toBe(400);
});

test('the server reports problems as a capability it actually serves', async ({ page }) => {
  const info = await page.request.get('/api/v1/server').then((r) => r.json());
  expect(info.features.problems).toBe(true);
  expect(info.features.health).toBe(true);
  expect(info.features.brief).toBe(true);
  expect(info.features.errors).toBe(true);
  expect(info.features.incidents).toBe(true);
  expect(info.features.synthetics).toBe(true);
  expect(info.features.slos).toBe(true);
  // LOG-5 and INV-1 landed, and the flags moved with the endpoints rather than ahead of them.
  expect(info.features.logs).toBe(true);
  expect(info.features.investigations).toBe(true);
  // And still reports the ones it does not, so a client gates on the flag rather than on a field existing.
  expect(info.features.ai).toBe(false);
  expect(info.features.services).toBe(false);
  expect(info.features.infrastructure).toBe(false);
});

test('a problem id from another environment reads as absent', async ({ page }) => {
  const response = await page.request.get(`/api/v1/problems/no-such-problem?env=${connectionId}:${MOTO_REGION}`);
  expect(response.status()).toBe(404);
});

test('the Problems page renders at 360px without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(problemsUrl());
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('client-side navigation into Problems works', async ({ page }) => {
  await page.goto(`/en/c/${connectionId}/${MOTO_REGION}/overview/insights`);
  const response = await page.request.get(problemsUrl(), { headers: rscHeaders(['(app)', 'c', connectionId, MOTO_REGION, 'overview', 'problems']) });
  expect(response.status()).toBe(200);
});

test('a filter the server will not honour is refused, not silently dropped', async ({ page }) => {
  const base = `/api/v1/problems?env=${connectionId}:${MOTO_REGION}`;
  // The exact shape that failed in the field: a parameter the route did not read, answered with a full page.
  expect((await page.request.get(`${base}&category=infrastructure`)).status()).toBe(400);
  // A declared filter with an undeclared value fails too, rather than answering a narrower question.
  expect((await page.request.get(`${base}&status=nonsense`)).status()).toBe(400);
  expect((await page.request.get(`${base}&severity=disastrous`)).status()).toBe(400);
  expect((await page.request.get(`${base}&since=yesterday`)).status()).toBe(400);
  expect((await page.request.get(`${base}&service=a&service=b`)).status()).toBe(400);
});

test('the filters a client may send are in the OpenAPI document', async ({ page }) => {
  const doc = await page.request.get('/api/v1/openapi.json').then((r) => r.json());
  const parameters = doc.paths['/api/v1/problems'].get.parameters ?? [];
  const names = parameters.filter((p: { in: string }) => p.in === 'query').map((p: { name: string }) => p.name);
  // Undiscoverable filters are how a client comes to invent its own request vocabulary.
  expect(names.sort()).toEqual(['service', 'severity', 'since', 'status']);
});

test('filters that are honoured actually narrow the list', async ({ page }) => {
  const base = `/api/v1/problems?env=${connectionId}:${MOTO_REGION}`;
  const all = await page.request.get(base).then((r) => r.json());
  const resolved = await page.request.get(`${base}&status=resolved`).then((r) => r.json());
  expect(Array.isArray(resolved.items)).toBe(true);
  // Every row that came back is the status that was asked for — the assertion the silent drop would fail.
  for (const item of resolved.items) expect(item.status).toBe('resolved');
  expect(resolved.items.length).toBeLessThanOrEqual(all.items.length);
});

test('§7 — the three evidence bands are visibly separate, and a guess is never presented as a fact', async ({ page }) => {
  await page.goto(problemsUrl());
  const first = page.locator('main a[href*="/overview/problems/"]').first();
  if ((await first.count()) === 0) test.skip(true, 'no problem detected in this environment');
  await first.click();
  await expect(page).toHaveURL(/\/overview\/problems\/[^/]+$/);

  const main = await page.locator('main').innerText();
  // Either the timeline has bands, or it says plainly that nothing else was recorded. Never a blank.
  const hasBands = main.includes('Observed facts');
  const saysNothing = main.includes('recorded nothing else around the time this started');
  expect(hasBands !== saysNothing).toBe(true);

  if (hasBands) {
    // Three headed groups, in order, so position alone tells a reader which band they are in.
    for (const band of ['Observed facts', 'Happened near each other', 'Possible explanations']) {
      await expect(page.getByRole('heading', { name: band })).toBeVisible();
    }
    expect(main.indexOf('Observed facts')).toBeLessThan(main.indexOf('Possible explanations'));
    // The sentence that keeps the middle band honest.
    expect(main).toContain('This is a measured gap, not a cause');
    // And the word the whole design forbids.
    expect(main).not.toMatch(/\bcaused by\b/i);
  } else {
    expect(main).toContain('not the same as nothing having happened');
  }
});

test('§7 — a problem with no deployment near it shows no correlation card at all', async ({ page }) => {
  await page.goto(problemsUrl());
  const first = page.locator('main a[href*="/overview/problems/"]').first();
  if ((await first.count()) === 0) test.skip(true, 'no problem detected in this environment');

  await first.click();
  await expect(page).toHaveURL(/\/overview\/problems\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Evidence' })).toBeVisible();
  const main = await page.locator('main').innerText();
  // The deployments job has recorded nothing here, so the card is absent rather than an empty list that
  // would read as "nothing was deployed".
  expect(main).not.toContain('Deployments just before this started');
});

test('THE RULING: a problem answers what, how serious, for how long and where — in its first line', async ({ page }) => {
  await page.goto(problemsUrl());
  // The list itself, not every `li` on the page — the breadcrumb is one too.
  const rows = page.locator('main a[href*="/overview/problems/"]');
  // The moto estate may be healthy; when it is, the empty-state test above is the one that applies.
  test.skip((await rows.count()) === 0, 'no problem in this environment to read');

  const first = await rows.first().innerText();
  // A short name for the kind, not the detector id and not the full sentence.
  expect(first).not.toMatch(/^[a-z_]+$/);
  // Severity, state and duration on the same line as the headline.
  expect(first).toMatch(/Critical|Warning|Info/i);
  expect(first).toMatch(/minute/i);
});

test('THE RULING: a problem detail says why OpsWatch opened it, and refuses to invent user impact', async ({ page }) => {
  await page.goto(problemsUrl());
  // The same selector the correlation test uses: a link into a problem, wherever the card puts it.
  const first = page.locator('main a[href*="/overview/problems/"]').first();
  test.skip((await first.count()) === 0, 'no problem in this environment to read');

  await first.click();
  await expect(page).toHaveURL(/\/overview\/problems\/[0-9a-f]+$/);
  const body = await page.locator('main').innerText();

  // The three questions the page exists to answer, in the order it answers them.
  expect(body).toContain('What this affected');
  expect(body).toContain('Why OpsWatch opened this');
  expect(body).toContain('What to check');

  // Impact is established or explicitly not. Never implied.
  expect(body).toMatch(/User impact not established|Measured against real traffic/);

  // And the lifecycle that closes it, so "is it over?" has an answer.
  expect(body).toContain('three consecutive readings that are clear');

  // Nothing anywhere claims a cause.
  expect(body).not.toMatch(/root cause|caused by/i);

  // The shape of it over time, and an honest word about the chart rather than an empty one.
  expect(body).toContain('Over time');
  expect(body).toMatch(/Opened|Came back|Stopped/);
  expect(body).toMatch(/Historical collection is off|has not stored anything for this resource|The measured signal/);

  // And the counter that used to read "115 times" now says what it counts.
  expect(body).toContain('Readings that confirmed it');
});

test('THE RULING: possible causes are offered as possibilities, or not at all', async ({ page }) => {
  await page.goto(problemsUrl());
  const first = page.locator('main a[href*="/overview/problems/"]').first();
  test.skip((await first.count()) === 0, 'no problem in this environment to read');

  await first.click();
  const body = await page.locator('main').innerText();

  if (body.includes('Possible causes')) {
    // Never presented as a finding: the card says in its own words that nothing here was checked.
    expect(body).toContain('OpsWatch has not checked any of them against this problem');
    // And it comes after the measured cards, so it reads as a list of maybes rather than a conclusion.
    expect(body.indexOf('Possible causes')).toBeGreaterThan(body.indexOf('Why OpsWatch opened this'));
  } else {
    // The alarm case: somebody else's rule, with somebody else's intention. OpsWatch offers no story.
    expect(body).toMatch(/alarm/i);
  }
  expect(body).not.toMatch(/root cause|caused by/i);
});

test('THE RULING: a page says its own name once', async ({ page }) => {
  // Every one of these carried a card that repeated the page header's title *and* its description, so an
  // operator read "Problems / What OpsWatch believes is wrong right now" twice before reaching a problem.
  for (const subsection of ['brief', 'health', 'problems', 'checkup', 'alerts', 'incidents', 'synthetics'] as const) {
    await page.goto(`/en/c/${connectionId}/${MOTO_REGION}/overview/${subsection}`);
    const h1 = await page.getByRole('heading', { level: 1 }).first().innerText();
    // Visible headings only: a card may still label itself for a screen reader, and that is not a repeat
    // anybody reads twice.
    const repeats = page.locator('main h2:not(:has(.sr-only))').filter({ hasText: new RegExp(`^${h1}$`) });
    await expect(repeats, subsection).toHaveCount(0);
  }
});

/**
 * The investigation workspace (INV-5, §R).
 *
 * The two questions the problem page could not answer: has this happened before, and where do I read the
 * actual log lines. Both are answered from rows that already exist, and both carry the shape of what is
 * missing when it is missing.
 */
test('THE RULING: the facts band shows the time it promises, so two facts are not one line twice', async ({ page }) => {
  await page.goto(problemsUrl());
  const first = page.locator('main a[href*="/overview/problems/"]').first();
  test.skip((await first.count()) === 0, 'no problem in this environment to read');
  await first.click();

  const facts = page.locator('main section[aria-labelledby="band-facts"]');
  await expect(facts).toContainText('with the time it recorded them');
  const rows = facts.getByRole('listitem');
  if ((await rows.count()) > 0) {
    // A `<time>` per fact: the band said it would, and without one two "A problem opened" rows were
    // indistinguishable.
    await expect(facts.locator('time')).toHaveCount(await rows.count());
  }
});

test('THE RULING: "first time" is never said without how far back the record goes', async ({ page }) => {
  await page.goto(problemsUrl());
  const first = page.locator('main a[href*="/overview/problems/"]').first();
  test.skip((await first.count()) === 0, 'no problem in this environment to read');
  await first.click();

  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'Has this happened before?' })).toBeVisible();
  const body = await main.innerText();
  if (body.includes('No earlier occurrence of this fault is recorded')) {
    // On an instance that started yesterday, "this has not happened before" means nothing at all.
    expect(body).toMatch(/OpsWatch has been recording problems since|has not recorded any problem yet/);
  } else {
    expect(body).toContain('stayed open');
  }
});

test('THE RULING: nothing being read and nothing being found are different sentences', async ({ page }) => {
  await page.goto(problemsUrl());
  const first = page.locator('main a[href*="/overview/problems/"]').first();
  test.skip((await first.count()) === 0, 'no problem in this environment to read');
  await first.click();

  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'The logs behind it' })).toBeVisible();
  const body = await main.innerText();
  // Exactly one of the two, and the "not collected" one says it is not the same as there being none.
  const notCollected = body.includes('so no error has been read');
  const none = body.includes('No error group has been seen on this service');
  expect(notCollected !== none).toBe(true);
  if (notCollected) expect(body).toContain('That is not the same as there being none');
});

test('the workspace links into the logs with the groups OpsWatch already reads, or says why it cannot', async ({ page }) => {
  await page.goto(problemsUrl());
  const first = page.locator('main a[href*="/overview/problems/"]').first();
  test.skip((await first.count()) === 0, 'no problem in this environment to read');
  await first.click();

  const main = page.locator('main');
  const link = main.locator('a[href*="/logs/search?"]');
  if ((await link.count()) === 0) {
    // Offering to search a log group nobody selected would be spending somebody's bill on a guess.
    await expect(main).toContainText('OpsWatch does not know where it writes');
    return;
  }
  const href = (await link.first().getAttribute('href')) as string;
  const params = new URL(href, 'https://example.com').searchParams;
  expect(params.getAll('group').length).toBeGreaterThan(0);
  expect(['1h', '3h', '12h', '24h']).toContain(params.get('range'));

  await link.first().click();
  // It lands on a search with those groups already ticked, and nothing has been run.
  await expect(page).toHaveURL(/\/logs\/search\?/);
  await expect(page.getByText('Nothing has been searched yet.')).toBeVisible();
});

/**
 * INV-1 — the investigation of a problem, over `/api/v1`.
 *
 * The whole value is the separation: an observed fact, a correlation and a hypothesis are three different
 * kinds of claim, and a client that flattens them lets a guess inherit the authority of a measurement. So
 * what this checks is that they arrive apart, and that a hypothesis never arrives carrying `kind: fact`.
 */
test('THE RULING: an investigation keeps facts, correlations and hypotheses apart', async ({ page }) => {
  const env = `${connectionId}:${MOTO_REGION}`;
  const list = await page.request.get(`/api/v1/problems?env=${env}`).then((r) => r.json());
  const first = (list.items as { id: string }[])[0];
  test.skip(first === undefined, 'no problem has been detected in this environment yet');

  // The problem says where its investigation is, so a client follows a field rather than guessing an id.
  const problem = await page.request.get(`/api/v1/problems/${first.id}?env=${env}`).then((r) => r.json());
  expect(problem.investigationId).toBe(first.id);

  const response = await page.request.get(`/api/v1/investigations/${problem.investigationId}?env=${env}`);
  expect(response.status(), await response.text()).toBe(200);
  const investigation = investigationSchema.parse(await response.json());

  expect(investigation.id).toBe(first.id);
  expect(investigation.subject).toMatchObject({ type: 'problem', id: first.id });
  // Derived from the problem, so its status can only follow it.
  expect(investigation.status).toBe(problem.status === 'resolved' ? 'concluded' : 'open');
  if (investigation.status === 'open') expect(investigation.concludedAt).toBeUndefined();
  // Nobody wrote a summary, and a generated one would be a conclusion with an author's authority.
  expect(investigation.summary).toBeUndefined();

  // Every entry declares which of the three bands it is, and nothing arrives unbanded.
  for (const entry of investigation.timeline) {
    expect(['fact', 'correlation', 'hypothesis']).toContain(entry.kind);
    // A fact is not a judgement, so it carries no confidence; a hypothesis must carry one.
    if (entry.kind === 'fact') expect(entry.confidence).toBeUndefined();
    if (entry.kind === 'hypothesis') expect(['low', 'medium', 'high']).toContain(entry.confidence);
    // No key path ever reaches a reader, here or anywhere.
    expect(entry.title).not.toMatch(/^(Monitoring|Insights)\./);
  }

  // Scoped like the problem it belongs to: an id from another environment is absent, not somebody else's.
  expect((await page.request.get(`/api/v1/investigations/${first.id}?env=deadbeefcafe:us-east-1`)).status()).toBe(404);
  expect((await page.request.get(`/api/v1/investigations/does-not-exist?env=${env}`)).status()).toBe(404);
});
