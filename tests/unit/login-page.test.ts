import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEnv, type Env } from '@/lib/env';
import { TEST_SECRET } from '../helpers/fixtures';

const state = vi.hoisted(() => ({ env: undefined as unknown as Env }));

vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  env: () => state.env,
}));
vi.mock('@/lib/db/client', () => ({ getDb: () => ({}) }));
vi.mock('@/lib/auth/admin', () => ({ hasAdmin: () => true }));
vi.mock('@/lib/auth/current', () => ({ getCurrentAdminId: async () => null }));
vi.mock('next-intl/server', () => ({
  setRequestLocale: () => undefined,
  getTranslations: async () => (key: string) => `Auth.login.${key}`,
}));
// The shell and the client form are not what this test is about.
vi.mock('@/components/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/app/[locale]/login/login-form', () => ({
  LoginForm: ({ initialError }: { initialError?: string }) => createElement('form', { 'data-error': initialError ?? '' }),
}));
vi.mock('@/app/[locale]/login/actions', () => ({ loginAction: async () => ({}) }));

const { default: LoginPage } = await import('@/app/[locale]/login/page');

const GOOGLE_ENV = {
  OPSWATCH_SECRET: TEST_SECRET,
  OPSWATCH_GOOGLE_CLIENT_ID: 'test-client',
  OPSWATCH_GOOGLE_CLIENT_SECRET: 'test-secret',
  OPSWATCH_PUBLIC_URL: 'https://ops.example.com',
};

async function render(error?: string) {
  const page = await LoginPage({
    params: Promise.resolve({ locale: 'fr' }),
    searchParams: Promise.resolve(error === undefined ? {} : { error }),
  });
  return renderToStaticMarkup(page);
}

beforeEach(() => {
  state.env = loadEnv(GOOGLE_ENV);
});

describe('login page', () => {
  it('offers Google sign-in when it is configured', async () => {
    const html = await render();
    expect(html).toContain('href="/api/auth/google/start?locale=fr"');
    expect(html).toContain('Auth.login.google');
    expect(html).toContain('Auth.login.or');
  });

  it('hides the Google button when Google sign-in is disabled', async () => {
    state.env = loadEnv({ ...GOOGLE_ENV, OPSWATCH_PUBLIC_URL: undefined });
    const html = await render();
    expect(html).not.toContain('/api/auth/google/start');
    expect(html).not.toContain('Auth.login.google');
    expect(html).toContain('<form');
  });

  it('passes only known redirect errors to the form', async () => {
    expect(await render('google_not_allowed')).toContain('data-error="google_not_allowed"');
    expect(await render('<script>')).toContain('data-error=""');
  });
});
