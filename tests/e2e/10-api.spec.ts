import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import {
  API_PREFIX,
  authSessionSchema,
  environmentListSchema,
  meSchema,
  serverInfoSchema,
  sessionListSchema,
} from '@opswatch/contract';
import { ADMIN, MOTO_REGION, login } from './helpers';

const v1 = (path: string) => `${API_PREFIX}${path}`;

/** Parses a recorded response with the schema the contract promises for it, and returns what came out. */
async function parsed<T>(response: APIResponse, schema: { parse: (value: unknown) => T }): Promise<T> {
  expect(response.status(), await response.text()).toBe(200);
  return schema.parse(await response.json());
}

function expectApiHeaders(response: APIResponse) {
  expect(response.headers()['cache-control']).toBe('no-store');
  // CORS stays off: no browser on another origin may talk to this API.
  for (const header of Object.keys(response.headers())) expect(header).not.toMatch(/^access-control-/);
}

async function bearer(request: APIRequestContext): Promise<string> {
  const response = await request.post(v1('/auth/login'), { data: { email: ADMIN.email, password: ADMIN.password } });
  const session = await parsed(response, authSessionSchema);
  return session.token;
}

const auth = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

test('server info is public, says what it can do, and carries no credential', async ({ request }) => {
  const response = await request.get(v1('/server'));
  expectApiHeaders(response);
  const info = await parsed(response, serverInfoSchema);
  expect(info.product).toBe('opswatch');
  expect(info.apiVersion).toBe(1);
  expect(info.auth.password).toBe(true);
  expect(info.demo).toBe(false);
  // Push is declared off for this mission; the rest report exactly what this build serves.
  expect(info.features.environments).toBe(true);
  expect(info.features.push).toBe(false);
  // Built and served; the ones still false are the ones with no implementation behind them.
  expect(info.features.health).toBe(true);
  expect(info.features.errors).toBe(false);
  const body = await request.get(v1('/server')).then((r) => r.text());
  for (const secret of [ADMIN.password, 'passwordHash', 'OPSWATCH_SECRET', 'sqlite']) {
    expect(body).not.toContain(secret);
  }
});

test('a wrong password is refused with the shared error envelope', async ({ request }) => {
  const response = await request.post(v1('/auth/login'), { data: { email: ADMIN.email, password: 'not the password' } });
  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({ error: 'invalid_credentials' });
  expectApiHeaders(response);
});

test('a malformed body is refused before anything is read', async ({ request }) => {
  const response = await request.post(v1('/auth/login'), { data: { email: ADMIN.email } });
  expect(response.status()).toBe(400);
  expect(await response.json()).toEqual({ error: 'invalid_request' });
});

test('signing in mints a bearer token that answers /me and /environments', async ({ request }) => {
  const token = await bearer(request);
  expect(token.length).toBeGreaterThanOrEqual(16);

  const me = await parsed(await request.get(v1('/me'), auth(token)), meSchema);
  expect(me.email).toBe(ADMIN.email);
  expect(me.role).toBe('admin');
  expect(me.allowedActions).toContain('administer');

  const response = await request.get(v1('/environments'), auth(token));
  expectApiHeaders(response);
  const environments = await parsed(response, environmentListSchema);
  expect(environments.nextCursor).toBeNull();
  expect(environments.items.length).toBeGreaterThan(0);
  // An environment id is the connection and region pair every data call is scoped to with ?env=.
  for (const environment of environments.items) expect(environment.id).toMatch(/^[0-9a-f]{12}:[a-z0-9-]+$/);
  expect(environments.items.some((environment) => environment.id.endsWith(`:${MOTO_REGION}`))).toBe(true);
  expect(environments.items.every((environment) => environment.name.includes('—'))).toBe(true);
});

test('no token, an unknown token and an empty header are all refused', async ({ request }) => {
  for (const options of [{}, auth('nonsense'), { headers: { authorization: 'Bearer ' } }]) {
    const response = await request.get(v1('/me'), options);
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  }
});

test('a bearer token cannot be replayed as the browser session cookie', async ({ request, playwright, baseURL }) => {
  const token = await bearer(request);
  const asCookie = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { cookie: `opswatch_session=${token}` },
  });
  expect((await asCookie.get(v1('/me'))).status()).toBe(401);
  // And the page it would really be after stays out of reach too.
  expect((await asCookie.get('/en/accounts')).url()).toContain('/login');
  await asCookie.dispose();
  // The token itself still works where it belongs, so the refusal did not destroy it.
  expect((await request.get(v1('/me'), auth(token))).status()).toBe(200);
});

test('the browser session cookie cannot be replayed as a bearer token', async ({ page, playwright, baseURL }) => {
  await login(page);
  const cookie = (await page.context().cookies()).find((candidate) => candidate.name === 'opswatch_session');
  expect(cookie?.value).toBeTruthy();
  const anonymous = await playwright.request.newContext({ baseURL });
  const response = await anonymous.get(v1('/me'), auth(cookie?.value ?? ''));
  expect(response.status()).toBe(401);
  await anonymous.dispose();
});

test('the cookie a browser already holds signs its own API calls', async ({ page }) => {
  await login(page);
  const me = await parsed(await page.request.get(v1('/me')), meSchema);
  expect(me.email).toBe(ADMIN.email);
});

test('sessions are listed without any credential, and one can be cut off on its own', async ({ request, playwright, baseURL }) => {
  const kept = await bearer(request);
  const lostContext = await playwright.request.newContext({ baseURL });
  const lost = await bearer(lostContext);

  const listed = await parsed(await lostContext.get(v1('/me/sessions'), auth(lost)), sessionListSchema);
  expect(listed.items.length).toBeGreaterThanOrEqual(2);
  const current = listed.items.find((item) => item.current);
  expect(current?.audience).toBe('api');
  expect(current?.absoluteExpiresAt).toBeGreaterThan(current?.expiresAt ?? 0);
  const serialised = JSON.stringify(listed);
  for (const token of [kept, lost]) expect(serialised).not.toContain(token);

  const revoked = await request.delete(v1(`/me/sessions/${current?.id}`), auth(kept));
  expect(revoked.status()).toBe(204);
  expect((await lostContext.get(v1('/me'), auth(lost))).status()).toBe(401);
  // Cutting one device off leaves every other session alone.
  expect((await request.get(v1('/me'), auth(kept))).status()).toBe(200);
  await lostContext.dispose();
});

test('revoking a session nobody owns answers not found', async ({ request }) => {
  const token = await bearer(request);
  const response = await request.delete(v1('/me/sessions/0000000000000000'), auth(token));
  expect(response.status()).toBe(404);
  expect(await response.json()).toEqual({ error: 'not_found' });
});

test('logging out revokes the token that asked', async ({ request }) => {
  const token = await bearer(request);
  const response = await request.post(v1('/auth/logout'), auth(token));
  expect(response.status()).toBe(204);
  expect(await response.text()).toBe('');
  expect((await request.get(v1('/me'), auth(token))).status()).toBe(401);
});

test('a mutating call from another origin is refused when it carries the cookie', async ({ page }) => {
  await login(page);
  const response = await page.request.post(v1('/auth/logout'), { headers: { origin: 'https://evil.example' } });
  expect(response.status()).toBe(403);
  expect(await response.json()).toEqual({ error: 'forbidden_origin' });
});

test('the OpenAPI document describes every route the server implements', async ({ request }) => {
  const response = await request.get(v1('/openapi.json'));
  expect(response.status()).toBe(200);
  const document = (await response.json()) as { paths: Record<string, Record<string, unknown>> };
  const expected: [string, string][] = [
    ['/server', 'get'],
    ['/openapi.json', 'get'],
    ['/auth/login', 'post'],
    ['/auth/logout', 'post'],
    ['/me', 'get'],
    ['/me/sessions', 'get'],
    ['/me/sessions/{id}', 'delete'],
    ['/environments', 'get'],
  ];
  for (const [path, method] of expected) {
    expect(document.paths[v1(path)], `${method.toUpperCase()} ${path}`).toBeDefined();
    expect(Object.keys(document.paths[v1(path)])).toContain(method);
  }
});
