# OpsWatch Step 1 — Foundations and AWS Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-hosted Next.js app, in English and French, with a public "Getting started" guide, an admin login, and the ability to connect an AWS account by IAM role (CloudFormation + ExternalId), ambient credentials or access keys, then test its permissions service by service.

**Architecture:** One Next.js 16 App Router application; every AWS call runs server-side. Pure, dependency-injected modules in `src/lib` (env, crypto, db, auth, aws, connections) are unit-tested with Vitest; pages and server actions are thin and covered by Playwright end-to-end tests that run against a local moto AWS emulator through Docker Compose.

**Tech Stack:** Next.js 16.3.5, React 19.3, TypeScript 5.9.3, ESLint 9.39.5, next-intl 4.14.5, Tailwind CSS 4.3, shadcn/ui 4.21 (radix base), next-themes 0.4.6, Drizzle ORM 0.45.2 + better-sqlite3 13.0.3, @node-rs/argon2 2.2.1, AWS SDK v3 3.1134.0, zod 4.6.5, yaml 2.9.1, Vitest 5.0.1, aws-sdk-client-mock 4.1.0, Playwright 1.63.0, moto 5.2.3, cfn-lint 1.56.3.

**Spec:** `docs/superpowers/specs/2026-09-17-opswatch-foundations-design.md`

## Global Constraints

- Version policy: use the latest published version of every dependency (versions above were read from npm, Docker Hub and PyPI on 2026-09-17), with two verified exceptions. TypeScript stays on 5.9.3 because TypeScript 7 no longer exposes the compiler API (`createProgram`, `readConfigFile`) that `next build` and typescript-eslint call. ESLint stays on 9.39.5 because `eslint-config-next` 16.3.5 bundles `eslint-plugin-react`, `eslint-plugin-import` and `eslint-plugin-jsx-a11y`, whose peer range stops at ESLint 9.
- Node.js 22 (`>=22.12`), npm. Project root: `/var/www/html/opswatch`.
- TypeScript strict; import alias `@/*` → `src/*`.
- License MIT.
- Locales exactly `en` (default) and `fr`; URL prefix always (`/en/...`, `/fr/...`); `/` redirects to `/<locale>` using the `NEXT_LOCALE` cookie if valid, else `en`; `Accept-Language` is never used.
- No user-facing string in code: every string lives in `messages/en.json` and `messages/fr.json` with identical keys. IAM actions, ARNs, CLI commands are never translated.
- Every AWS call is server-side. Credentials never reach the browser; stored access keys are never returned after save.
- `OPSWATCH_SECRET` required, at least 32 characters; the server refuses to start without it.
- Access keys encrypted with AES-256-GCM, key derived from `OPSWATCH_SECRET` with HKDF-SHA256.
- Admin password hashed with argon2id. Session cookie `opswatch_session`: `HttpOnly`, `SameSite=Lax`, `Secure` when `OPSWATCH_PUBLIC_URL` starts with `https://`, 12 h rolling expiry, stored server-side as an HMAC of the token.
- Login rate limit: 5 attempts per minute per client, and 20 per minute across all clients (client IP headers can be forged).
- Public routes: `/<locale>/setup` (only while no admin exists), `/<locale>/login`, `/<locale>/getting-started`, `/`. Everything else requires a session; with no admin, protected routes redirect to setup.
- Mutating API route handlers verify the `Origin` header.
- IAM role name `OpsWatchReadOnly-<connection id>`; `MaxSessionDuration` 3600; AssumeRole `DurationSeconds` 3600, `RoleSessionName` `opswatch-<connection id>`; cached credentials refreshed when less than 5 minutes remain.
- Template version constant `TEMPLATE_VERSION = 1`.
- Permission test: 5 s timeout per call; `logs:StartQuery` is never called by the test.
- OpsWatch base identity policy: only `sts:AssumeRole` on `arn:aws:iam::*:role/OpsWatchReadOnly-*`.
- Commit messages end with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## File Structure

```
opswatch/
├── package.json, tsconfig.json, next.config.ts, vitest.config.ts, drizzle.config.ts
├── components.json                         (shadcn)
├── drizzle/                                generated SQL migrations
├── messages/en.json, messages/fr.json
├── scripts/write-sample-template.ts        writes a template for cfn-lint
├── src/
│   ├── instrumentation.ts                  env validation + migrations at server start
│   ├── proxy.ts                            `/` locale redirect, next-intl routing
│   ├── i18n/routing.ts, request.ts, navigation.ts, locale-cookie.ts
│   ├── lib/
│   │   ├── env.ts                          zod-validated environment
│   │   ├── crypto.ts                       encrypt/decrypt, token HMAC, random ids
│   │   ├── utils.ts                        (shadcn cn helper)
│   │   ├── http/origin.ts                  same-origin check
│   │   ├── db/schema.ts, db/client.ts
│   │   ├── auth/password.ts, admin.ts, sessions.ts, rate-limit.ts, current.ts
│   │   ├── aws/client-config.ts            region/endpoint/credentials for SDK clients
│   │   ├── aws/actions.ts                  IAM action catalogue, base policy, version
│   │   ├── aws/identity.ts                 GetCallerIdentity, trust principal
│   │   ├── aws/template.ts                 CloudFormation template + CLI + quick-create URL
│   │   ├── aws/credentials.ts              role / ambient / keys resolver with cache
│   │   ├── aws/permissions.ts              per-service permission test
│   │   └── connections/repository.ts, validation.ts, test-connection.ts, resolver.ts
│   ├── components/
│   │   ├── ui/*                            shadcn components
│   │   ├── app-shell.tsx, sidebar.tsx, top-bar.tsx
│   │   ├── locale-switcher.tsx, theme-toggle.tsx, theme-provider.tsx
│   │   ├── connection-switcher.tsx
│   │   ├── connection-status-badge.tsx, permission-checklist.tsx, copy-button.tsx
│   │   └── getting-started/connection-diagram.tsx, method-cards.tsx, steps.tsx,
│   │       service-cards.tsx, security-section.tsx, troubleshooting.tsx
│   └── app/
│       ├── globals.css
│       ├── [locale]/layout.tsx, page.tsx
│       ├── [locale]/setup/page.tsx, actions.ts
│       ├── [locale]/login/page.tsx, actions.ts
│       ├── [locale]/getting-started/page.tsx
│       ├── [locale]/(app)/layout.tsx
│       ├── [locale]/(app)/accounts/page.tsx, actions.ts
│       ├── [locale]/(app)/accounts/new/page.tsx
│       ├── [locale]/(app)/accounts/[id]/page.tsx, test-button.tsx
│       └── api/connections/[id]/test/route.ts, api/connections/[id]/template/route.ts
├── tests/
│   ├── stubs/server-only.ts
│   ├── helpers/db.ts
│   ├── unit/*.test.ts
│   └── e2e/*.spec.ts, playwright.config.ts
├── Dockerfile, docker-compose.yml, docker-compose.test.yml, .dockerignore, .env.example
├── .github/workflows/ci.yml, .github/ISSUE_TEMPLATE/*, .github/pull_request_template.md
└── README.md, README.fr.md, LICENSE, CONTRIBUTING.md, SECURITY.md
```

Design rule: everything in `src/lib` takes its dependencies (db, secret, clock, clients) as parameters so it can be unit-tested without Next.js. Files under `src/app` only read the request, call `src/lib`, and render.

---

### Task 1: Scaffold the project and the unit test harness

**Files:**
- Create (generated): the Next.js app in `/var/www/html/opswatch`
- Create: `vitest.config.ts`, `tests/stubs/server-only.ts`, `tests/unit/smoke.test.ts`, `.nvmrc`
- Modify: `package.json` (scripts, pinned versions), `next.config.ts`, `.gitignore`

**Interfaces:**
- Produces: `npm test` (Vitest, `tests/unit/**/*.test.ts`), `npm run typecheck`, `npm run lint`, alias `@/` in both Next and Vitest, `server-only` stubbed in tests.

- [ ] **Step 1: Generate the app inside the existing repository**

The directory already contains `.git` and `docs/`, which create-next-app accepts.

```bash
cd /var/www/html/opswatch
npx -y create-next-app@16.3.5 . --ts --tailwind --eslint --app --src-dir \
  --import-alias "@/*" --use-npm --disable-git --yes
```

Expected: `package.json`, `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css` exist.

- [ ] **Step 2: Pin TypeScript and install runtime dependencies**

```bash
npm install -D --save-exact typescript@5.9.3 eslint@9.39.5 eslint-config-next@16.3.5
npm install next-intl@4.14.5 next-themes@0.4.6 zod@4.6.5 yaml@2.9.1 \
  drizzle-orm@0.45.2 better-sqlite3@13.0.3 @node-rs/argon2@2.2.1 server-only@0.0.1 \
  @aws-sdk/client-sts@3.1134.0 @aws-sdk/client-ecs@3.1134.0 \
  @aws-sdk/client-elastic-load-balancing-v2@3.1134.0 @aws-sdk/client-rds@3.1134.0 \
  @aws-sdk/client-pi@3.1134.0 @aws-sdk/client-cloudwatch@3.1134.0 \
  @aws-sdk/client-cloudwatch-logs@3.1134.0 @aws-sdk/client-s3@3.1134.0 \
  @aws-sdk/credential-providers@3.1134.0 @smithy/types@4.18.0 lucide-react@1.47.0
npm install -D vitest@5.0.1 aws-sdk-client-mock@4.1.0 drizzle-kit@0.31.10 \
  @types/better-sqlite3@9.6.0 tsx@4.23.13 @playwright/test@1.63.0
```

- [ ] **Step 3: Configure Vitest**

Create `vitest.config.ts`:

```ts
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    restoreMocks: true,
  },
});
```

Create `tests/stubs/server-only.ts`:

```ts
// The real `server-only` package throws outside a React Server Component bundle.
export {};
```

- [ ] **Step 4: Add scripts and Node version**

In `package.json`, replace the `"scripts"` object with:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint .",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "db:generate": "drizzle-kit generate",
  "lint:template": "tsx scripts/write-sample-template.ts && docker run --rm -v \"$PWD/tmp:/data\" python:3.13-slim sh -c \"pip install -q cfn-lint==1.56.3 && cfn-lint /data/opswatch-sample.yaml\"",
  "e2e": "playwright test --config tests/e2e/playwright.config.ts"
},
"engines": { "node": ">=22.12" }
```

Create `.nvmrc` containing `22`.

Append to `.gitignore`:

```
/tmp
/data
/test-results
/playwright-report
*.sqlite
*.sqlite-*
.env
```

- [ ] **Step 5: Configure Next.js for native packages and Docker**

Replace `next.config.ts` with:

```ts
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3', '@node-rs/argon2'],
};

export default createNextIntlPlugin('./src/i18n/request.ts')(nextConfig);
```

`src/i18n/request.ts` is created in Task 5; the build is not run before then.

- [ ] **Step 6: Write a smoke test**

Create `tests/unit/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('test harness', () => {
  it('resolves the @ alias', async () => {
    const mod = await import('@/lib/utils');
    expect(typeof mod.cn).toBe('function');
  });
});
```

- [ ] **Step 7: Run it and see it fail**

Run: `npm test`
Expected: FAIL, cannot resolve `@/lib/utils` (created by shadcn in Task 6). Create it now minimally so the harness is proven:

```bash
mkdir -p src/lib
```

Create `src/lib/utils.ts`:

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

```bash
npm install clsx@2.1.1 tailwind-merge@3.7.0
```

- [ ] **Step 8: Run tests, typecheck, lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: 1 test passes; typecheck and lint exit 0.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app and unit test harness

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Environment validation, crypto and random identifiers

**Files:**
- Create: `src/lib/env.ts`, `src/lib/crypto.ts`, `src/instrumentation.ts`
- Test: `tests/unit/env.test.ts`, `tests/unit/crypto.test.ts`

**Interfaces:**
- Produces:
  - `type Env = { OPSWATCH_SECRET: string; OPSWATCH_DATA_DIR: string; OPSWATCH_PUBLIC_URL?: string; OPSWATCH_TEMPLATE_BUCKET?: string; OPSWATCH_AWS_ENDPOINT_URL?: string }`
  - `loadEnv(source?: Record<string, string | undefined>): Env` — throws `EnvError` listing invalid variables
  - `env(): Env` — cached `loadEnv(process.env)`
  - `class EnvError extends Error`
  - `encrypt(plaintext: string, secret: string): string` (base64url of iv‖tag‖ciphertext)
  - `decrypt(payload: string, secret: string): string` — throws `DecryptionError`
  - `class DecryptionError extends Error`
  - `hashToken(token: string, secret: string): string` (hex HMAC-SHA256 with a derived key)
  - `randomToken(bytes?: number): string` (base64url, default 32 bytes)
  - `randomId(): string` (12 lowercase hex characters)

- [ ] **Step 1: Write the failing env tests**

Create `tests/unit/env.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EnvError, loadEnv } from '@/lib/env';

const SECRET = 'x'.repeat(32);

describe('loadEnv', () => {
  it('accepts a minimal valid environment and applies defaults', () => {
    const env = loadEnv({ OPSWATCH_SECRET: SECRET });
    expect(env.OPSWATCH_SECRET).toBe(SECRET);
    expect(env.OPSWATCH_DATA_DIR).toBe('/data');
    expect(env.OPSWATCH_PUBLIC_URL).toBeUndefined();
  });

  it('rejects a missing secret', () => {
    expect(() => loadEnv({})).toThrow(EnvError);
  });

  it('rejects a secret shorter than 32 characters', () => {
    expect(() => loadEnv({ OPSWATCH_SECRET: 'short' })).toThrow(/OPSWATCH_SECRET/);
  });

  it('rejects malformed URLs', () => {
    expect(() =>
      loadEnv({ OPSWATCH_SECRET: SECRET, OPSWATCH_PUBLIC_URL: 'not a url' }),
    ).toThrow(/OPSWATCH_PUBLIC_URL/);
  });

  it('keeps optional values when valid', () => {
    const env = loadEnv({
      OPSWATCH_SECRET: SECRET,
      OPSWATCH_DATA_DIR: '/tmp/ow',
      OPSWATCH_PUBLIC_URL: 'https://ops.example.com',
      OPSWATCH_TEMPLATE_BUCKET: 'my-bucket',
      OPSWATCH_AWS_ENDPOINT_URL: 'http://moto:5000',
    });
    expect(env).toMatchObject({
      OPSWATCH_DATA_DIR: '/tmp/ow',
      OPSWATCH_PUBLIC_URL: 'https://ops.example.com',
      OPSWATCH_TEMPLATE_BUCKET: 'my-bucket',
      OPSWATCH_AWS_ENDPOINT_URL: 'http://moto:5000',
    });
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/unit/env.test.ts`
Expected: FAIL, cannot resolve `@/lib/env`.

- [ ] **Step 3: Implement `src/lib/env.ts`**

```ts
import { z } from 'zod';

const schema = z.object({
  OPSWATCH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  OPSWATCH_DATA_DIR: z.string().min(1).default('/data'),
  OPSWATCH_PUBLIC_URL: z.url().optional(),
  OPSWATCH_TEMPLATE_BUCKET: z.string().min(3).optional(),
  OPSWATCH_AWS_ENDPOINT_URL: z.url().optional(),
});

export type Env = z.infer<typeof schema>;

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvError';
  }
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new EnvError(`Invalid OpsWatch configuration: ${details}`);
  }
  return parsed.data;
}

let cached: Env | undefined;

export function env(): Env {
  cached ??= loadEnv(process.env);
  return cached;
}
```

- [ ] **Step 4: Run env tests**

Run: `npx vitest run tests/unit/env.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Write the failing crypto tests**

Create `tests/unit/crypto.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DecryptionError, decrypt, encrypt, hashToken, randomId, randomToken } from '@/lib/crypto';

const SECRET = 'a'.repeat(32);
const OTHER = 'b'.repeat(32);

describe('encrypt / decrypt', () => {
  it('round-trips a value', () => {
    const payload = encrypt('{"accessKeyId":"AKIA"}', SECRET);
    expect(payload).not.toContain('AKIA');
    expect(decrypt(payload, SECRET)).toBe('{"accessKeyId":"AKIA"}');
  });

  it('uses a fresh IV each time', () => {
    expect(encrypt('same', SECRET)).not.toBe(encrypt('same', SECRET));
  });

  it('rejects a tampered payload', () => {
    const payload = Buffer.from(encrypt('secret', SECRET), 'base64url');
    payload[payload.length - 1] ^= 0xff;
    expect(() => decrypt(payload.toString('base64url'), SECRET)).toThrow(DecryptionError);
  });

  it('rejects a payload encrypted with another secret', () => {
    expect(() => decrypt(encrypt('secret', SECRET), OTHER)).toThrow(DecryptionError);
  });

  it('rejects garbage', () => {
    expect(() => decrypt('abc', SECRET)).toThrow(DecryptionError);
  });
});

describe('hashToken', () => {
  it('is deterministic per secret and differs across secrets', () => {
    expect(hashToken('t', SECRET)).toBe(hashToken('t', SECRET));
    expect(hashToken('t', SECRET)).not.toBe(hashToken('t', OTHER));
    expect(hashToken('t', SECRET)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('random values', () => {
  it('randomToken is base64url of 32 bytes by default', () => {
    expect(Buffer.from(randomToken(), 'base64url')).toHaveLength(32);
  });

  it('randomId is 12 lowercase hex characters', () => {
    expect(randomId()).toMatch(/^[0-9a-f]{12}$/);
  });
});
```

- [ ] **Step 6: Run to see it fail**

Run: `npx vitest run tests/unit/crypto.test.ts`
Expected: FAIL, cannot resolve `@/lib/crypto`.

- [ ] **Step 7: Implement `src/lib/crypto.ts`**

```ts
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

type Purpose = 'access-keys' | 'sessions';

function deriveKey(secret: string, purpose: Purpose): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'opswatch', purpose, 32));
}

export class DecryptionError extends Error {
  constructor() {
    super('Stored secret could not be decrypted (tampered data or changed OPSWATCH_SECRET)');
    this.name = 'DecryptionError';
  }
}

export function encrypt(plaintext: string, secret: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret, 'access-keys'), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

export function decrypt(payload: string, secret: string): string {
  try {
    const data = Buffer.from(payload, 'base64url');
    if (data.length < IV_LENGTH + TAG_LENGTH + 1) {
      throw new Error('payload too short');
    }
    const iv = data.subarray(0, IV_LENGTH);
    const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret, 'access-keys'), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new DecryptionError();
  }
}

export function hashToken(token: string, secret: string): string {
  return createHmac('sha256', deriveKey(secret, 'sessions')).update(token).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function randomId(): string {
  return randomBytes(6).toString('hex');
}
```

- [ ] **Step 8: Run crypto tests**

Run: `npx vitest run tests/unit/crypto.test.ts`
Expected: 8 passed.

- [ ] **Step 9: Refuse to start without a valid environment**

Create `src/instrumentation.ts`:

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }
  const { loadEnv, EnvError } = await import('./lib/env');
  try {
    loadEnv(process.env);
  } catch (error) {
    if (error instanceof EnvError) {
      console.error(`[opswatch] ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}
```

Database migrations are added to this function in Task 3.

- [ ] **Step 10: Run the whole suite and commit**

Run: `npm test && npm run typecheck`
Expected: all tests pass.

```bash
git add -A
git commit -m "feat: validate environment and add crypto helpers

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---
### Task 3: Database schema, migrations and shared connection types

**Files:**
- Create: `src/lib/connections/types.ts`, `src/lib/db/schema.ts`, `src/lib/db/client.ts`, `drizzle.config.ts`, `tests/helpers/db.ts`
- Create (generated): `drizzle/*` migration files
- Modify: `src/instrumentation.ts`
- Test: `tests/unit/db.test.ts`

**Interfaces:**
- Consumes: `env()` from Task 2.
- Produces:
  - `CONNECTION_METHODS = ['role','ambient','keys'] as const`, `type ConnectionMethod`
  - `CONNECTION_STATUSES = ['draft','pending','ok','degraded','failed'] as const`, `type ConnectionStatus`
  - `CHECKED_SERVICES = ['ecs','elb','rds','pi','cloudwatch','logs'] as const`, `type CheckedService`
  - `type CheckStatus = 'ok' | 'denied' | 'error' | 'not_applicable'`
  - `type ServiceCheck = { service: CheckedService; region: string; action: string; status: CheckStatus; errorCode?: string; checkedAt: string }`
  - `type OverallStatus = 'ok' | 'degraded' | 'failed'`
  - `type PermissionTestResult = { overall: OverallStatus; accountMatches: boolean; identityArn?: string; identityError?: string; checks: ServiceCheck[]; testedAt: string }`
  - Drizzle tables `adminUser`, `sessions`, `connections`; `type ConnectionRow = typeof connections.$inferSelect`
  - `type Db`, `createDb(filename: string): Db` (runs migrations), `getDb(): Db` (singleton in `OPSWATCH_DATA_DIR/opswatch.sqlite`)
  - `createTestDb(): Db` (in-memory)

- [ ] **Step 1: Create the shared types**

Create `src/lib/connections/types.ts`:

```ts
export const CONNECTION_METHODS = ['role', 'ambient', 'keys'] as const;
export type ConnectionMethod = (typeof CONNECTION_METHODS)[number];

export const CONNECTION_STATUSES = ['draft', 'pending', 'ok', 'degraded', 'failed'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const CHECKED_SERVICES = ['ecs', 'elb', 'rds', 'pi', 'cloudwatch', 'logs'] as const;
export type CheckedService = (typeof CHECKED_SERVICES)[number];

export type CheckStatus = 'ok' | 'denied' | 'error' | 'not_applicable';

export type ServiceCheck = {
  service: CheckedService;
  region: string;
  action: string;
  status: CheckStatus;
  errorCode?: string;
  checkedAt: string;
};

export type OverallStatus = 'ok' | 'degraded' | 'failed';

export type PermissionTestResult = {
  overall: OverallStatus;
  accountMatches: boolean;
  identityArn?: string;
  identityError?: string;
  checks: ServiceCheck[];
  testedAt: string;
};
```

- [ ] **Step 2: Write the failing database test**

Create `tests/helpers/db.ts`:

```ts
import { createDb, type Db } from '@/lib/db/client';

export function createTestDb(): Db {
  return createDb(':memory:');
}
```

Create `tests/unit/db.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { adminUser, connections, sessions } from '@/lib/db/schema';
import { createTestDb } from '../helpers/db';

const now = new Date('2026-09-17T10:00:00Z');

describe('database', () => {
  it('applies migrations and stores an admin', () => {
    const db = createTestDb();
    db.insert(adminUser).values({ email: 'admin@example.com', passwordHash: 'h', createdAt: now }).run();
    expect(db.select().from(adminUser).all()).toHaveLength(1);
  });

  it('round-trips JSON columns on connections', () => {
    const db = createTestDb();
    db.insert(connections)
      .values({
        id: 'abc123def456',
        name: 'production',
        method: 'role',
        awsAccountId: '123456789012',
        regions: ['eu-west-1', 'us-east-1'],
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const row = db.select().from(connections).where(eq(connections.id, 'abc123def456')).get();
    expect(row?.regions).toEqual(['eu-west-1', 'us-east-1']);
    expect(row?.lastTest).toBeNull();
  });

  it('deletes sessions when their admin is deleted', () => {
    const db = createTestDb();
    const { id } = db
      .insert(adminUser)
      .values({ email: 'a@example.com', passwordHash: 'h', createdAt: now })
      .returning({ id: adminUser.id })
      .get();
    db.insert(sessions).values({ id: 'token-hash', adminUserId: id, expiresAt: now, createdAt: now }).run();
    db.delete(adminUser).where(eq(adminUser.id, id)).run();
    expect(db.select().from(sessions).all()).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run to see it fail**

Run: `npx vitest run tests/unit/db.test.ts`
Expected: FAIL, cannot resolve `@/lib/db/client`.

- [ ] **Step 4: Write the schema**

Create `src/lib/db/schema.ts` (relative imports: drizzle-kit does not resolve the `@` alias):

```ts
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import {
  CONNECTION_METHODS,
  CONNECTION_STATUSES,
  type PermissionTestResult,
} from '../connections/types';

export const adminUser = sqliteTable('admin_user', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  adminUserId: integer('admin_user_id')
    .notNull()
    .references(() => adminUser.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const connections = sqliteTable('connections', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  method: text('method', { enum: CONNECTION_METHODS }).notNull(),
  awsAccountId: text('aws_account_id').notNull(),
  regions: text('regions', { mode: 'json' }).$type<string[]>().notNull(),
  roleArn: text('role_arn'),
  externalId: text('external_id'),
  templateVersion: integer('template_version'),
  accessKeyCiphertext: text('access_key_ciphertext'),
  status: text('status', { enum: CONNECTION_STATUSES }).notNull(),
  lastTest: text('last_test', { mode: 'json' }).$type<PermissionTestResult>(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export type ConnectionRow = typeof connections.$inferSelect;
```

- [ ] **Step 5: Generate the migration**

Create `drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
});
```

Run: `npm run db:generate`
Expected: a `drizzle/0000_<generated_name>.sql` file creating `admin_user`, `sessions`, `connections`, plus `drizzle/meta/`.

- [ ] **Step 6: Write the client**

Create `src/lib/db/client.ts`:

```ts
import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { env } from '../env';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

export const MIGRATIONS_FOLDER = path.join(process.cwd(), 'drizzle');

export function createDb(filename: string): Db {
  if (filename !== ':memory:') {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }
  const sqlite = new Database(filename);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle({ client: sqlite, schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

let instance: Db | undefined;

export function getDb(): Db {
  instance ??= createDb(path.join(env().OPSWATCH_DATA_DIR, 'opswatch.sqlite'));
  return instance;
}
```

- [ ] **Step 7: Run the database tests**

Run: `npx vitest run tests/unit/db.test.ts`
Expected: 3 passed.

- [ ] **Step 8: Migrate at server start**

In `src/instrumentation.ts`, after the `try { loadEnv(process.env); } catch ... ` block and before the closing brace of `register`, add:

```ts
  const { getDb } = await import('./lib/db/client');
  getDb();
```

- [ ] **Step 9: Run the suite and commit**

Run: `npm test && npm run typecheck`
Expected: all pass.

```bash
git add -A
git commit -m "feat: add SQLite schema, migrations and connection types

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Admin account, sessions and login rate limit

**Files:**
- Create: `src/lib/auth/password.ts`, `src/lib/auth/admin.ts`, `src/lib/auth/sessions.ts`, `src/lib/auth/rate-limit.ts`
- Test: `tests/unit/auth.test.ts`, `tests/unit/rate-limit.test.ts`

**Interfaces:**
- Consumes: `Db`, `adminUser`, `sessions` (Task 3); `hashToken`, `randomToken` (Task 2).
- Produces:
  - `MIN_PASSWORD_LENGTH = 12`
  - `hashPassword(password: string): Promise<string>`, `verifyPassword(passwordHash: string, password: string): Promise<boolean>`
  - `class AdminValidationError extends Error { code: 'email_invalid' | 'password_too_short' }`, `class AdminExistsError extends Error`
  - `hasAdmin(db: Db): boolean`
  - `createAdmin(db: Db, input: { email: string; password: string }, now?: Date): Promise<number>`
  - `authenticate(db: Db, email: string, password: string): Promise<number | null>`
  - `SESSION_TTL_MS = 43_200_000`
  - `createSession(db: Db, adminUserId: number, secret: string, now?: Date): string`
  - `validateSession(db: Db, token: string, secret: string, now?: Date): number | null`
  - `deleteSession(db: Db, token: string, secret: string): void`
  - `type RateLimiter = { attempt(key: string, now?: number): boolean; reset(key: string): void }`
  - `createRateLimiter(options: { limit: number; windowMs: number }): RateLimiter`

- [ ] **Step 1: Write the failing auth tests**

Create `tests/unit/auth.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  AdminExistsError,
  AdminValidationError,
  authenticate,
  createAdmin,
  hasAdmin,
} from '@/lib/auth/admin';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { SESSION_TTL_MS, createSession, deleteSession, validateSession } from '@/lib/auth/sessions';
import { createTestDb } from '../helpers/db';

const SECRET = 's'.repeat(32);
const PASSWORD = 'correct horse battery';

describe('password hashing', () => {
  it('hashes with argon2id and verifies', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, PASSWORD)).toBe(true);
    expect(await verifyPassword(hash, 'wrong password!')).toBe(false);
  });

  it('returns false for a malformed hash instead of throwing', async () => {
    expect(await verifyPassword('not-a-hash', PASSWORD)).toBe(false);
  });
});

describe('admin account', () => {
  it('creates the single admin and authenticates it', async () => {
    const db = createTestDb();
    expect(hasAdmin(db)).toBe(false);
    const id = await createAdmin(db, { email: 'Admin@Example.com', password: PASSWORD });
    expect(hasAdmin(db)).toBe(true);
    expect(await authenticate(db, 'admin@example.com', PASSWORD)).toBe(id);
    expect(await authenticate(db, 'admin@example.com', 'wrong password!')).toBeNull();
    expect(await authenticate(db, 'nobody@example.com', PASSWORD)).toBeNull();
  });

  it('refuses a second admin', async () => {
    const db = createTestDb();
    await createAdmin(db, { email: 'a@example.com', password: PASSWORD });
    await expect(createAdmin(db, { email: 'b@example.com', password: PASSWORD })).rejects.toBeInstanceOf(
      AdminExistsError,
    );
  });

  it('validates email and password length', async () => {
    const db = createTestDb();
    await expect(createAdmin(db, { email: 'nope', password: PASSWORD })).rejects.toMatchObject({
      code: 'email_invalid',
    });
    await expect(createAdmin(db, { email: 'a@example.com', password: 'short' })).rejects.toBeInstanceOf(
      AdminValidationError,
    );
  });
});

describe('sessions', () => {
  it('creates, validates with rolling expiry, and deletes', async () => {
    const db = createTestDb();
    const adminId = await createAdmin(db, { email: 'a@example.com', password: PASSWORD });
    const t0 = new Date('2026-09-17T10:00:00Z');
    const token = createSession(db, adminId, SECRET, t0);

    const t1 = new Date(t0.getTime() + SESSION_TTL_MS - 60_000);
    expect(validateSession(db, token, SECRET, t1)).toBe(adminId);

    // rolling: still valid one full TTL after the last use
    const t2 = new Date(t1.getTime() + SESSION_TTL_MS - 60_000);
    expect(validateSession(db, token, SECRET, t2)).toBe(adminId);

    deleteSession(db, token, SECRET);
    expect(validateSession(db, token, SECRET, t2)).toBeNull();
  });

  it('rejects an expired session and a token checked with another secret', async () => {
    const db = createTestDb();
    const adminId = await createAdmin(db, { email: 'a@example.com', password: PASSWORD });
    const t0 = new Date('2026-09-17T10:00:00Z');
    const token = createSession(db, adminId, SECRET, t0);
    expect(validateSession(db, token, 'o'.repeat(32), t0)).toBeNull();
    expect(validateSession(db, token, SECRET, new Date(t0.getTime() + SESSION_TTL_MS + 1))).toBeNull();
  });
});
```

Create `tests/unit/rate-limit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '@/lib/auth/rate-limit';

describe('rate limiter', () => {
  it('allows 5 attempts per minute per key', () => {
    const limiter = createRateLimiter({ limit: 5, windowMs: 60_000 });
    for (let i = 0; i < 5; i++) {
      expect(limiter.attempt('1.2.3.4', 1_000 + i)).toBe(true);
    }
    expect(limiter.attempt('1.2.3.4', 1_010)).toBe(false);
    expect(limiter.attempt('5.6.7.8', 1_010)).toBe(true);
  });

  it('frees attempts once the window has passed', () => {
    const limiter = createRateLimiter({ limit: 5, windowMs: 60_000 });
    for (let i = 0; i < 5; i++) limiter.attempt('ip', 0);
    expect(limiter.attempt('ip', 59_999)).toBe(false);
    expect(limiter.attempt('ip', 60_001)).toBe(true);
  });

  it('reset clears a key', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    limiter.attempt('ip', 0);
    limiter.reset('ip');
    expect(limiter.attempt('ip', 1)).toBe(true);
  });

  it('forgets keys whose window has passed, so forged keys cannot grow memory forever', () => {
    const limiter = createRateLimiter({ limit: 5, windowMs: 60_000, maxKeys: 3 });
    for (const key of ['a', 'b', 'c']) limiter.attempt(key, 0);
    expect(limiter.size()).toBe(3);
    limiter.attempt('d', 60_001);
    expect(limiter.size()).toBe(1);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/unit/auth.test.ts tests/unit/rate-limit.test.ts`
Expected: FAIL, cannot resolve `@/lib/auth/admin` and `@/lib/auth/rate-limit`.

- [ ] **Step 3: Implement `src/lib/auth/password.ts`**

```ts
import { hash, verify } from '@node-rs/argon2';

export const MIN_PASSWORD_LENGTH = 12;

// @node-rs/argon2 defaults to argon2id. Parameters follow the OWASP minimum
// (19 MiB memory, 2 iterations, parallelism 1).
export async function hashPassword(password: string): Promise<string> {
  return hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Implement `src/lib/auth/admin.ts`**

```ts
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { adminUser } from '../db/schema';
import { MIN_PASSWORD_LENGTH, hashPassword, verifyPassword } from './password';

export class AdminValidationError extends Error {
  constructor(public readonly code: 'email_invalid' | 'password_too_short') {
    super(code);
    this.name = 'AdminValidationError';
  }
}

export class AdminExistsError extends Error {
  constructor() {
    super('An admin account already exists');
    this.name = 'AdminExistsError';
  }
}

let dummyHash: Promise<string> | undefined;

export function hasAdmin(db: Db): boolean {
  return db.select({ id: adminUser.id }).from(adminUser).limit(1).get() !== undefined;
}

export async function createAdmin(
  db: Db,
  input: { email: string; password: string },
  now: Date = new Date(),
): Promise<number> {
  const email = input.email.trim().toLowerCase();
  if (!z.email().safeParse(email).success) {
    throw new AdminValidationError('email_invalid');
  }
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new AdminValidationError('password_too_short');
  }
  if (hasAdmin(db)) {
    throw new AdminExistsError();
  }
  const passwordHash = await hashPassword(input.password);
  const row = db
    .insert(adminUser)
    .values({ email, passwordHash, createdAt: now })
    .returning({ id: adminUser.id })
    .get();
  return row.id;
}

export async function authenticate(db: Db, email: string, password: string): Promise<number | null> {
  const row = db
    .select()
    .from(adminUser)
    .where(eq(adminUser.email, email.trim().toLowerCase()))
    .get();
  if (!row) {
    // Spend the same time as a real check so response time does not reveal the email.
    dummyHash ??= hashPassword('opswatch-timing-equaliser');
    await verifyPassword(await dummyHash, password);
    return null;
  }
  return (await verifyPassword(row.passwordHash, password)) ? row.id : null;
}
```

- [ ] **Step 5: Implement `src/lib/auth/sessions.ts`**

```ts
import { eq } from 'drizzle-orm';
import { hashToken, randomToken } from '../crypto';
import type { Db } from '../db/client';
import { sessions } from '../db/schema';

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function createSession(db: Db, adminUserId: number, secret: string, now: Date = new Date()): string {
  const token = randomToken();
  db.insert(sessions)
    .values({
      id: hashToken(token, secret),
      adminUserId,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      createdAt: now,
    })
    .run();
  return token;
}

export function validateSession(db: Db, token: string, secret: string, now: Date = new Date()): number | null {
  const id = hashToken(token, secret);
  const row = db.select().from(sessions).where(eq(sessions.id, id)).get();
  if (!row) {
    return null;
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    db.delete(sessions).where(eq(sessions.id, id)).run();
    return null;
  }
  db.update(sessions)
    .set({ expiresAt: new Date(now.getTime() + SESSION_TTL_MS) })
    .where(eq(sessions.id, id))
    .run();
  return row.adminUserId;
}

export function deleteSession(db: Db, token: string, secret: string): void {
  db.delete(sessions).where(eq(sessions.id, hashToken(token, secret))).run();
}
```

- [ ] **Step 6: Implement `src/lib/auth/rate-limit.ts`**

```ts
export type RateLimiter = {
  attempt(key: string, now?: number): boolean;
  reset(key: string): void;
  size(): number;
};

export function createRateLimiter(options: { limit: number; windowMs: number; maxKeys?: number }): RateLimiter {
  const hits = new Map<string, number[]>();
  const maxKeys = options.maxKeys ?? 10_000;

  return {
    attempt(key, now = Date.now()) {
      if (hits.size >= maxKeys) {
        for (const [k, times] of hits) {
          if (times.every((t) => now - t >= options.windowMs)) hits.delete(k);
        }
      }
      const recent = (hits.get(key) ?? []).filter((t) => now - t < options.windowMs);
      if (recent.length >= options.limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
    reset(key) {
      hits.delete(key);
    },
    size() {
      return hits.size;
    },
  };
}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/unit/auth.test.ts tests/unit/rate-limit.test.ts`
Expected: 11 passed.

- [ ] **Step 8: Commit**

Run: `npm test && npm run typecheck`

```bash
git add -A
git commit -m "feat: add admin account, sessions and login rate limit

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Internationalisation routing and base messages

**Files:**
- Create: `src/i18n/routing.ts`, `src/i18n/request.ts`, `src/i18n/navigation.ts`, `src/i18n/locale-cookie.ts`, `src/proxy.ts`, `messages/en.json`, `messages/fr.json`, `src/app/[locale]/layout.tsx`, `src/app/[locale]/page.tsx`, `src/app/[locale]/getting-started/page.tsx`
- Delete: `src/app/layout.tsx`, `src/app/page.tsx`
- Test: `tests/unit/i18n-messages.test.ts`, `tests/unit/proxy.test.ts`

**Interfaces:**
- Produces:
  - `routing` (`locales: ['en','fr']`, `defaultLocale: 'en'`, `localePrefix: 'always'`, `localeDetection: false`, `localeCookie: false`)
  - `type AppLocale = 'en' | 'fr'`
  - `Link`, `redirect`, `usePathname`, `useRouter`, `getPathname` from `@/i18n/navigation`
  - `LOCALE_COOKIE = 'NEXT_LOCALE'`, `LOCALE_COOKIE_MAX_AGE = 31_536_000`
  - `proxy(request: NextRequest): NextResponse` and its `config.matcher`
  - Message namespace `Common` (keys listed in Step 3), extended by later tasks
  - `[locale]/layout.tsx` renders `<html>`/`<body>`; later tasks add providers to it

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/i18n-messages.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((acc, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      acc[path] = value;
    } else {
      Object.assign(acc, flatten(value, path));
    }
    return acc;
  }, {});
}

describe('message catalogues', () => {
  const enKeys = flatten(en as Tree);
  const frKeys = flatten(fr as Tree);

  it('have exactly the same keys in English and French', () => {
    expect(Object.keys(frKeys).sort()).toEqual(Object.keys(enKeys).sort());
  });

  it('have no empty strings', () => {
    for (const [key, value] of Object.entries({ ...enKeys, ...frKeys })) {
      expect(value.trim(), key).not.toBe('');
    }
  });
});
```

Create `tests/unit/proxy.test.ts`:

```ts
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { proxy } from '@/proxy';

function request(path: string, cookie?: string) {
  return new NextRequest(`http://localhost:3000${path}`, cookie ? { headers: { cookie } } : undefined);
}

describe('proxy', () => {
  it('redirects / to English by default', () => {
    const res = proxy(request('/'));
    expect(res.headers.get('location')).toBe('http://localhost:3000/en');
  });

  it('redirects / to the saved locale', () => {
    const res = proxy(request('/', 'NEXT_LOCALE=fr'));
    expect(res.headers.get('location')).toBe('http://localhost:3000/fr');
  });

  it('ignores an unsupported saved locale and the Accept-Language header', () => {
    const req = new NextRequest('http://localhost:3000/', {
      headers: { cookie: 'NEXT_LOCALE=de', 'accept-language': 'fr-FR,fr;q=0.9' },
    });
    expect(proxy(req).headers.get('location')).toBe('http://localhost:3000/en');
  });

  it('adds the default prefix to an unprefixed path', () => {
    const res = proxy(request('/getting-started'));
    expect(res.headers.get('location')).toBe('http://localhost:3000/en/getting-started');
  });

  it('lets prefixed paths through', () => {
    const res = proxy(request('/fr/getting-started'));
    expect(res.headers.get('location')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/unit/i18n-messages.test.ts tests/unit/proxy.test.ts`
Expected: FAIL, missing `messages/en.json` and `@/proxy`.

- [ ] **Step 3: Create the base message catalogues**

Create `messages/en.json`:

```json
{
  "Common": {
    "appName": "OpsWatch",
    "tagline": "Observability for your AWS stack",
    "nav": {
      "gettingStarted": "Getting started",
      "accounts": "Accounts",
      "containers": "Containers",
      "databases": "Databases",
      "logs": "Logs",
      "comingSoon": "Coming soon",
      "signOut": "Sign out",
      "mainNavigation": "Main navigation"
    },
    "language": {
      "label": "Language",
      "en": "English",
      "fr": "Français"
    },
    "theme": {
      "label": "Theme",
      "light": "Light",
      "dark": "Dark",
      "system": "System"
    },
    "actions": {
      "copy": "Copy",
      "copied": "Copied",
      "save": "Save",
      "cancel": "Cancel",
      "continue": "Continue",
      "back": "Back",
      "download": "Download"
    },
    "errors": {
      "generic": "Something went wrong. Please try again."
    }
  }
}
```

Create `messages/fr.json`:

```json
{
  "Common": {
    "appName": "OpsWatch",
    "tagline": "L'observabilité de votre stack AWS",
    "nav": {
      "gettingStarted": "Premiers pas",
      "accounts": "Comptes",
      "containers": "Conteneurs",
      "databases": "Bases de données",
      "logs": "Logs",
      "comingSoon": "Bientôt",
      "signOut": "Se déconnecter",
      "mainNavigation": "Navigation principale"
    },
    "language": {
      "label": "Langue",
      "en": "English",
      "fr": "Français"
    },
    "theme": {
      "label": "Thème",
      "light": "Clair",
      "dark": "Sombre",
      "system": "Système"
    },
    "actions": {
      "copy": "Copier",
      "copied": "Copié",
      "save": "Enregistrer",
      "cancel": "Annuler",
      "continue": "Continuer",
      "back": "Retour",
      "download": "Télécharger"
    },
    "errors": {
      "generic": "Une erreur est survenue. Réessayez."
    }
  }
}
```

- [ ] **Step 4: Create the i18n modules**

Create `src/i18n/routing.ts`:

```ts
import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'fr'],
  defaultLocale: 'en',
  localePrefix: 'always',
  // The browser language is never used, and the locale cookie is managed by
  // OpsWatch itself (see locale-cookie.ts and proxy.ts).
  localeDetection: false,
  localeCookie: false,
});

export type AppLocale = (typeof routing.locales)[number];
```

Create `src/i18n/locale-cookie.ts`:

```ts
export const LOCALE_COOKIE = 'NEXT_LOCALE';
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
```

Create `src/i18n/request.ts`:

```ts
import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
```

Create `src/i18n/navigation.ts`:

```ts
import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
```

Create `src/proxy.ts`:

```ts
import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { LOCALE_COOKIE } from './i18n/locale-cookie';
import { routing, type AppLocale } from './i18n/routing';

const intl = createMiddleware(routing);

function isAppLocale(value: string | undefined): value is AppLocale {
  return routing.locales.includes(value as AppLocale);
}

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === '/') {
    const saved = request.cookies.get(LOCALE_COOKIE)?.value;
    const locale = isAppLocale(saved) ? saved : routing.defaultLocale;
    return NextResponse.redirect(new URL(`/${locale}`, request.url));
  }
  return intl(request);
}

export const config = {
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
};
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/unit/i18n-messages.test.ts tests/unit/proxy.test.ts`
Expected: 7 passed.

- [ ] **Step 6: Replace the default root layout with the locale layout**

```bash
git rm -q src/app/layout.tsx src/app/page.tsx
```

Create `src/app/[locale]/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import '../globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Omit<Props, 'children'>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Common' });
  return { title: { default: t('appName'), template: `%s · ${t('appName')}` }, description: t('tagline') };
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  return (
    <html lang={locale} suppressHydrationWarning className={inter.variable}>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
```

Create `src/app/[locale]/page.tsx`:

```tsx
import { redirect } from '@/i18n/navigation';

type Props = { params: Promise<{ locale: string }> };

export default async function LocaleHome({ params }: Props) {
  const { locale } = await params;
  redirect({ href: '/getting-started', locale });
}
```

Create `src/app/[locale]/getting-started/page.tsx` (its full content is written in Task 12):

```tsx
import { getTranslations, setRequestLocale } from 'next-intl/server';

type Props = { params: Promise<{ locale: string }> };

export default async function GettingStartedPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Common');
  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="text-3xl font-semibold">{t('appName')}</h1>
      <p className="mt-2 text-muted-foreground">{t('tagline')}</p>
    </main>
  );
}
```

- [ ] **Step 7: Verify the build and the redirects**

Run: `npm run build`
Expected: build succeeds; the route list shows `/[locale]` and `/[locale]/getting-started`.

Run:

```bash
OPSWATCH_SECRET=$(printf 'x%.0s' {1..40}) OPSWATCH_DATA_DIR=./tmp/data npm run start &
sleep 5
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3000/
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -H 'Cookie: NEXT_LOCALE=fr' http://localhost:3000/
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/fr/getting-started
kill %1
```

Expected: `307 http://localhost:3000/en`, `307 http://localhost:3000/fr`, `200`.

- [ ] **Step 8: Commit**

Run: `npm test && npm run typecheck && npm run lint`

```bash
git add -A
git commit -m "feat: add English/French routing with cookie-based root redirect

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: IAM action catalogue, caller identity and CloudFormation template

**Files:**
- Create: `src/lib/aws/client-config.ts`, `src/lib/aws/actions.ts`, `src/lib/aws/identity.ts`, `src/lib/aws/template.ts`, `src/lib/aws/template-upload.ts`, `scripts/write-sample-template.ts`
- Test: `tests/unit/aws-actions.test.ts`, `tests/unit/aws-identity.test.ts`, `tests/unit/aws-template.test.ts`

**Interfaces:**
- Produces:
  - `type AwsCredentials = AwsCredentialIdentity | AwsCredentialIdentityProvider`
  - `clientConfig(region: string, credentials?: AwsCredentials, endpoint?: string): { region: string; maxAttempts: number; credentials?: AwsCredentials; endpoint?: string }` (endpoint defaults to `process.env.OPSWATCH_AWS_ENDPOINT_URL`)
  - `TEMPLATE_VERSION = 1`, `ROLE_NAME_PREFIX = 'OpsWatchReadOnly-'`
  - `SERVICE_GROUP_IDS = ['ecs','ec2','autoscaling','elb','rds','pi','cloudwatch','logs'] as const`, `type ServiceGroupId`
  - `type ServiceGroup = { id: ServiceGroupId; actions: readonly string[]; billedActions: readonly string[] }`
  - `SERVICE_GROUPS: readonly ServiceGroup[]`, `allActions(): string[]`
  - `BASE_IDENTITY_POLICY` (JSON policy object)
  - `type CallerIdentity = { account: string; arn: string }`
  - `type TrustSpec = { principal: string; principalArnPattern?: string }`
  - `getCallerIdentity(credentials: AwsCredentials | undefined, region: string): Promise<CallerIdentity>`
  - `detectBaseIdentity(region: string, now?: number): Promise<CallerIdentity>` (cached 5 minutes)
  - `resetBaseIdentityCache(): void`
  - `trustFor(identity: CallerIdentity): TrustSpec`
  - `type TemplateInput = { connectionId: string; externalId: string; trust: TrustSpec }`
  - `roleNameFor(id)`, `stackNameFor(id)`, `templateFileNameFor(id)`: `string`
  - `buildTemplate(input: TemplateInput): Record<string, unknown>`, `renderTemplateYaml(input: TemplateInput): string`
  - `deployCommand(connectionId: string, region: string): string`
  - `roleArnCommand(connectionId: string, region: string): string`
  - `templateObjectKey(connectionId: string): string`
  - `quickCreateUrl(input: { bucket: string; connectionId: string; region: string }): string`
  - `uploadTemplate(input: { bucket: string; connectionId: string; region: string; body: string }): Promise<void>`

- [ ] **Step 1: Write the failing catalogue test**

Create `tests/unit/aws-actions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BASE_IDENTITY_POLICY, SERVICE_GROUPS, allActions } from '@/lib/aws/actions';

describe('IAM action catalogue', () => {
  it('lists the 37 read-only actions of the spec without duplicates', () => {
    const actions = allActions();
    expect(actions).toHaveLength(37);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it('never grants access to S3, Secrets Manager or SSM', () => {
    expect(allActions().filter((a) => /^(s3|secretsmanager|ssm):/.test(a))).toEqual([]);
  });

  it('only contains describe/list/get style actions plus Logs Insights queries', () => {
    const allowedLogs = ['logs:StartQuery', 'logs:StopQuery', 'logs:GetQueryResults'];
    for (const action of allActions()) {
      const verb = action.split(':')[1];
      expect(/^(Describe|List|Get)/.test(verb) || allowedLogs.includes(action), action).toBe(true);
    }
  });

  it('flags logs:StartQuery as billed', () => {
    expect(SERVICE_GROUPS.find((g) => g.id === 'logs')?.billedActions).toEqual(['logs:StartQuery']);
  });

  it('limits OpsWatch base identity to assuming OpsWatch roles', () => {
    expect(BASE_IDENTITY_POLICY.Statement).toEqual([
      { Effect: 'Allow', Action: 'sts:AssumeRole', Resource: 'arn:aws:iam::*:role/OpsWatchReadOnly-*' },
    ]);
  });
});
```

- [ ] **Step 2: Run to see it fail, then implement the catalogue and client config**

Run: `npx vitest run tests/unit/aws-actions.test.ts`
Expected: FAIL, cannot resolve `@/lib/aws/actions`.

Create `src/lib/aws/client-config.ts`:

```ts
import type { AwsCredentialIdentity, AwsCredentialIdentityProvider } from '@smithy/types';

export type AwsCredentials = AwsCredentialIdentity | AwsCredentialIdentityProvider;

export function clientConfig(
  region: string,
  credentials?: AwsCredentials,
  endpoint: string | undefined = process.env.OPSWATCH_AWS_ENDPOINT_URL,
) {
  return {
    region,
    maxAttempts: 2,
    ...(credentials ? { credentials } : {}),
    ...(endpoint ? { endpoint } : {}),
  };
}
```

Create `src/lib/aws/actions.ts`:

```ts
export const TEMPLATE_VERSION = 1;
export const ROLE_NAME_PREFIX = 'OpsWatchReadOnly-';

export const SERVICE_GROUP_IDS = ['ecs', 'ec2', 'autoscaling', 'elb', 'rds', 'pi', 'cloudwatch', 'logs'] as const;
export type ServiceGroupId = (typeof SERVICE_GROUP_IDS)[number];

export type ServiceGroup = {
  id: ServiceGroupId;
  actions: readonly string[];
  billedActions: readonly string[];
};

export const SERVICE_GROUPS: readonly ServiceGroup[] = [
  {
    id: 'ecs',
    actions: [
      'ecs:ListClusters',
      'ecs:DescribeClusters',
      'ecs:ListServices',
      'ecs:DescribeServices',
      'ecs:ListTasks',
      'ecs:DescribeTasks',
      'ecs:DescribeTaskDefinition',
      'ecs:ListContainerInstances',
      'ecs:DescribeContainerInstances',
    ],
    billedActions: [],
  },
  {
    id: 'ec2',
    actions: [
      'ec2:DescribeInstances',
      'ec2:DescribeNetworkInterfaces',
      'ec2:DescribeSecurityGroups',
      'ec2:DescribeSubnets',
    ],
    billedActions: [],
  },
  {
    id: 'autoscaling',
    actions: [
      'application-autoscaling:DescribeScalableTargets',
      'application-autoscaling:DescribeScalingPolicies',
    ],
    billedActions: [],
  },
  {
    id: 'elb',
    actions: [
      'elasticloadbalancing:DescribeLoadBalancers',
      'elasticloadbalancing:DescribeTargetGroups',
      'elasticloadbalancing:DescribeListeners',
      'elasticloadbalancing:DescribeRules',
      'elasticloadbalancing:DescribeTargetHealth',
    ],
    billedActions: [],
  },
  {
    id: 'rds',
    actions: ['rds:DescribeDBClusters', 'rds:DescribeDBInstances', 'rds:DescribeDBProxies', 'rds:DescribeEvents'],
    billedActions: [],
  },
  {
    id: 'pi',
    actions: [
      'pi:GetResourceMetrics',
      'pi:DescribeDimensionKeys',
      'pi:GetDimensionKeyDetails',
      'pi:ListAvailableResourceMetrics',
      'pi:ListAvailableResourceDimensions',
    ],
    billedActions: [],
  },
  {
    id: 'cloudwatch',
    actions: ['cloudwatch:GetMetricData', 'cloudwatch:ListMetrics', 'cloudwatch:DescribeAlarms'],
    billedActions: [],
  },
  {
    id: 'logs',
    actions: [
      'logs:DescribeLogGroups',
      'logs:DescribeLogStreams',
      'logs:StartQuery',
      'logs:GetQueryResults',
      'logs:StopQuery',
    ],
    billedActions: ['logs:StartQuery'],
  },
];

export function allActions(): string[] {
  return SERVICE_GROUPS.flatMap((group) => [...group.actions]);
}

export const BASE_IDENTITY_POLICY = {
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Action: 'sts:AssumeRole',
      Resource: `arn:aws:iam::*:role/${ROLE_NAME_PREFIX}*`,
    },
  ],
};
```

Run: `npx vitest run tests/unit/aws-actions.test.ts`
Expected: 5 passed.

- [ ] **Step 3: Write the failing identity test**

Create `tests/unit/aws-identity.test.ts`:

```ts
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { detectBaseIdentity, resetBaseIdentityCache, trustFor } from '@/lib/aws/identity';

const sts = mockClient(STSClient);

beforeEach(() => {
  sts.reset();
  resetBaseIdentityCache();
});

describe('trustFor', () => {
  it('trusts an IAM user by its exact ARN', () => {
    expect(trustFor({ account: '111122223333', arn: 'arn:aws:iam::111122223333:user/ops/opswatch' })).toEqual({
      principal: 'arn:aws:iam::111122223333:user/ops/opswatch',
    });
  });

  it('trusts an assumed role through the account root restricted to that role name', () => {
    expect(
      trustFor({ account: '111122223333', arn: 'arn:aws:sts::111122223333:assumed-role/opswatch-task/abc123' }),
    ).toEqual({
      principal: 'arn:aws:iam::111122223333:root',
      principalArnPattern: 'arn:aws:iam::111122223333:role/*opswatch-task',
    });
  });

  it('falls back to the account root for other identities', () => {
    expect(trustFor({ account: '111122223333', arn: 'arn:aws:iam::111122223333:root' })).toEqual({
      principal: 'arn:aws:iam::111122223333:root',
    });
  });

  it('keeps the partition', () => {
    expect(trustFor({ account: '111122223333', arn: 'arn:aws-us-gov:iam::111122223333:user/x' }).principal).toBe(
      'arn:aws-us-gov:iam::111122223333:user/x',
    );
  });
});

describe('detectBaseIdentity', () => {
  it('calls GetCallerIdentity once and caches the result for 5 minutes', async () => {
    sts.on(GetCallerIdentityCommand).resolves({ Account: '111122223333', Arn: 'arn:aws:iam::111122223333:user/o' });
    const first = await detectBaseIdentity('eu-west-1', 0);
    await detectBaseIdentity('eu-west-1', 4 * 60_000);
    expect(first).toEqual({ account: '111122223333', arn: 'arn:aws:iam::111122223333:user/o' });
    expect(sts.commandCalls(GetCallerIdentityCommand)).toHaveLength(1);
    await detectBaseIdentity('eu-west-1', 6 * 60_000);
    expect(sts.commandCalls(GetCallerIdentityCommand)).toHaveLength(2);
  });

  it('fails when AWS returns no account', async () => {
    sts.on(GetCallerIdentityCommand).resolves({});
    await expect(detectBaseIdentity('eu-west-1', 0)).rejects.toThrow(/no account/);
  });
});
```

- [ ] **Step 4: Run to see it fail, then implement `src/lib/aws/identity.ts`**

Run: `npx vitest run tests/unit/aws-identity.test.ts`
Expected: FAIL, cannot resolve `@/lib/aws/identity`.

```ts
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { clientConfig, type AwsCredentials } from './client-config';

export type CallerIdentity = { account: string; arn: string };
export type TrustSpec = { principal: string; principalArnPattern?: string };

const BASE_IDENTITY_TTL_MS = 5 * 60_000;
let baseIdentityCache: { identity: CallerIdentity; fetchedAt: number } | undefined;

export async function getCallerIdentity(
  credentials: AwsCredentials | undefined,
  region: string,
): Promise<CallerIdentity> {
  const client = new STSClient(clientConfig(region, credentials));
  const out = await client.send(new GetCallerIdentityCommand({}));
  if (!out.Account || !out.Arn) {
    throw new Error('GetCallerIdentity returned no account or ARN');
  }
  return { account: out.Account, arn: out.Arn };
}

/** Identity of the OpsWatch instance itself (standard AWS provider chain). */
export async function detectBaseIdentity(region: string, now: number = Date.now()): Promise<CallerIdentity> {
  if (baseIdentityCache && now - baseIdentityCache.fetchedAt < BASE_IDENTITY_TTL_MS) {
    return baseIdentityCache.identity;
  }
  const identity = await getCallerIdentity(undefined, region);
  baseIdentityCache = { identity, fetchedAt: now };
  return identity;
}

export function resetBaseIdentityCache(): void {
  baseIdentityCache = undefined;
}

export function trustFor(identity: CallerIdentity): TrustSpec {
  const partition = identity.arn.split(':')[1] ?? 'aws';
  const root = `arn:${partition}:iam::${identity.account}:root`;

  if (/^arn:[\w-]+:iam::\d{12}:user\//.test(identity.arn)) {
    return { principal: identity.arn };
  }

  const assumed = identity.arn.match(/^arn:[\w-]+:sts::(\d{12}):assumed-role\/([^/]+)\/[^/]+$/);
  if (assumed) {
    const [, account, roleName] = assumed;
    // An assumed-role session ARN hides the role path, so trust the account and
    // restrict the caller to roles with that name, whatever their path.
    return {
      principal: root,
      principalArnPattern: `arn:${partition}:iam::${account}:role/*${roleName}`,
    };
  }

  return { principal: root };
}
```

Run: `npx vitest run tests/unit/aws-identity.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Write the failing template test**

Create `tests/unit/aws-template.test.ts`:

```ts
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { TEMPLATE_VERSION, allActions } from '@/lib/aws/actions';
import {
  buildTemplate,
  deployCommand,
  quickCreateUrl,
  renderTemplateYaml,
  roleArnCommand,
  roleNameFor,
  templateObjectKey,
} from '@/lib/aws/template';
import { uploadTemplate } from '@/lib/aws/template-upload';

const input = {
  connectionId: 'abc123def456',
  externalId: 'ext-1234567890',
  trust: { principal: 'arn:aws:iam::111122223333:user/opswatch' },
};

type Template = {
  Resources: {
    OpsWatchReadOnlyRole: {
      Type: string;
      Properties: {
        RoleName: string;
        MaxSessionDuration: number;
        AssumeRolePolicyDocument: { Statement: Array<Record<string, unknown>> };
        Policies: Array<{ PolicyDocument: { Statement: Array<{ Action: string[]; Resource: string }> } }>;
      };
    };
  };
  Outputs: Record<string, { Value: unknown }>;
};

describe('CloudFormation template', () => {
  it('creates the read-only role with the exact actions', () => {
    const t = parse(renderTemplateYaml(input)) as Template;
    const role = t.Resources.OpsWatchReadOnlyRole;
    expect(role.Type).toBe('AWS::IAM::Role');
    expect(role.Properties.RoleName).toBe('OpsWatchReadOnly-abc123def456');
    expect(role.Properties.MaxSessionDuration).toBe(3600);
    const statement = role.Properties.Policies[0].PolicyDocument.Statement[0];
    expect(statement.Action).toEqual(allActions());
    expect(statement.Resource).toBe('*');
  });

  it('requires the ExternalId and trusts the given principal', () => {
    const t = buildTemplate(input) as unknown as Template;
    expect(t.Resources.OpsWatchReadOnlyRole.Properties.AssumeRolePolicyDocument.Statement[0]).toEqual({
      Effect: 'Allow',
      Principal: { AWS: 'arn:aws:iam::111122223333:user/opswatch' },
      Action: 'sts:AssumeRole',
      Condition: { StringEquals: { 'sts:ExternalId': 'ext-1234567890' } },
    });
  });

  it('adds a principal ARN condition when the trust spec has a pattern', () => {
    const t = buildTemplate({
      ...input,
      trust: { principal: 'arn:aws:iam::111122223333:root', principalArnPattern: 'arn:aws:iam::111122223333:role/*task' },
    }) as unknown as Template;
    expect(t.Resources.OpsWatchReadOnlyRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition).toEqual({
      StringEquals: { 'sts:ExternalId': 'ext-1234567890' },
      ArnLike: { 'aws:PrincipalArn': 'arn:aws:iam::111122223333:role/*task' },
    });
  });

  it('outputs the role ARN and the template version', () => {
    const t = buildTemplate(input) as unknown as Template;
    expect(t.Outputs.RoleArn.Value).toEqual({ 'Fn::GetAtt': ['OpsWatchReadOnlyRole', 'Arn'] });
    expect(t.Outputs.OpsWatchTemplateVersion.Value).toBe(String(TEMPLATE_VERSION));
  });

  it('builds the CLI commands and names', () => {
    expect(roleNameFor('abc123def456')).toBe('OpsWatchReadOnly-abc123def456');
    expect(deployCommand('abc123def456', 'eu-west-1')).toBe(
      'aws cloudformation deploy \\\n  --stack-name opswatch-abc123def456 \\\n  --template-file opswatch-abc123def456.yaml \\\n  --capabilities CAPABILITY_NAMED_IAM \\\n  --region eu-west-1',
    );
    expect(roleArnCommand('abc123def456', 'eu-west-1')).toBe(
      "aws cloudformation describe-stacks --stack-name opswatch-abc123def456 --region eu-west-1 --query \"Stacks[0].Outputs[?OutputKey=='RoleArn'].OutputValue\" --output text",
    );
  });

  it('builds the quick-create URL for a template in a bucket', () => {
    expect(templateObjectKey('abc123def456')).toBe('opswatch/templates/opswatch-abc123def456-v1.yaml');
    const url = new URL(quickCreateUrl({ bucket: 'my-bucket', connectionId: 'abc123def456', region: 'eu-west-1' }));
    expect(url.origin).toBe('https://console.aws.amazon.com');
    expect(url.searchParams.get('region')).toBe('eu-west-1');
    expect(url.hash).toBe(
      '#/stacks/quickcreate?templateURL=' +
        encodeURIComponent('https://my-bucket.s3.amazonaws.com/opswatch/templates/opswatch-abc123def456-v1.yaml') +
        '&stackName=opswatch-abc123def456',
    );
  });

  it('uploads the template to the configured bucket', async () => {
    const s3 = mockClient(S3Client);
    s3.on(PutObjectCommand).resolves({});
    await uploadTemplate({ bucket: 'my-bucket', connectionId: 'abc123def456', region: 'eu-west-1', body: 'yaml' });
    expect(s3.commandCalls(PutObjectCommand)[0].args[0].input).toEqual({
      Bucket: 'my-bucket',
      Key: 'opswatch/templates/opswatch-abc123def456-v1.yaml',
      Body: 'yaml',
      ContentType: 'application/x-yaml',
    });
  });
});
```

- [ ] **Step 6: Run to see it fail, then implement the template modules**

Run: `npx vitest run tests/unit/aws-template.test.ts`
Expected: FAIL, cannot resolve `@/lib/aws/template`.

Create `src/lib/aws/template.ts`:

```ts
import { stringify } from 'yaml';
import { ROLE_NAME_PREFIX, TEMPLATE_VERSION, allActions } from './actions';
import type { TrustSpec } from './identity';

export type TemplateInput = { connectionId: string; externalId: string; trust: TrustSpec };

export const roleNameFor = (connectionId: string) => `${ROLE_NAME_PREFIX}${connectionId}`;
export const stackNameFor = (connectionId: string) => `opswatch-${connectionId}`;
export const templateFileNameFor = (connectionId: string) => `opswatch-${connectionId}.yaml`;
export const templateObjectKey = (connectionId: string) =>
  `opswatch/templates/opswatch-${connectionId}-v${TEMPLATE_VERSION}.yaml`;

export function buildTemplate(input: TemplateInput): Record<string, unknown> {
  const condition: Record<string, unknown> = { StringEquals: { 'sts:ExternalId': input.externalId } };
  if (input.trust.principalArnPattern) {
    condition.ArnLike = { 'aws:PrincipalArn': input.trust.principalArnPattern };
  }

  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: `OpsWatch read-only access (template v${TEMPLATE_VERSION})`,
    Resources: {
      OpsWatchReadOnlyRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          RoleName: roleNameFor(input.connectionId),
          MaxSessionDuration: 3600,
          AssumeRolePolicyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: { AWS: input.trust.principal },
                Action: 'sts:AssumeRole',
                Condition: condition,
              },
            ],
          },
          Policies: [
            {
              PolicyName: 'OpsWatchReadOnly',
              PolicyDocument: {
                Version: '2012-10-17',
                Statement: [{ Effect: 'Allow', Action: allActions(), Resource: '*' }],
              },
            },
          ],
        },
      },
    },
    Outputs: {
      RoleArn: { Description: 'Paste this ARN into OpsWatch', Value: { 'Fn::GetAtt': ['OpsWatchReadOnlyRole', 'Arn'] } },
      OpsWatchTemplateVersion: { Value: String(TEMPLATE_VERSION) },
    },
  };
}

export function renderTemplateYaml(input: TemplateInput): string {
  return stringify(buildTemplate(input), { lineWidth: 0 });
}

export function deployCommand(connectionId: string, region: string): string {
  return [
    'aws cloudformation deploy',
    `--stack-name ${stackNameFor(connectionId)}`,
    `--template-file ${templateFileNameFor(connectionId)}`,
    '--capabilities CAPABILITY_NAMED_IAM',
    `--region ${region}`,
  ].join(' \\\n  ');
}

export function roleArnCommand(connectionId: string, region: string): string {
  return (
    `aws cloudformation describe-stacks --stack-name ${stackNameFor(connectionId)} --region ${region} ` +
    `--query "Stacks[0].Outputs[?OutputKey=='RoleArn'].OutputValue" --output text`
  );
}

export function quickCreateUrl(input: { bucket: string; connectionId: string; region: string }): string {
  const templateUrl = `https://${input.bucket}.s3.amazonaws.com/${templateObjectKey(input.connectionId)}`;
  return (
    `https://console.aws.amazon.com/cloudformation/home?region=${input.region}` +
    `#/stacks/quickcreate?templateURL=${encodeURIComponent(templateUrl)}&stackName=${stackNameFor(input.connectionId)}`
  );
}
```

Create `src/lib/aws/template-upload.ts`:

```ts
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { clientConfig } from './client-config';
import { templateObjectKey } from './template';

/** Uses OpsWatch's base identity, which then also needs s3:PutObject on this bucket. */
export async function uploadTemplate(input: {
  bucket: string;
  connectionId: string;
  region: string;
  body: string;
}): Promise<void> {
  const client = new S3Client(clientConfig(input.region));
  await client.send(
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: templateObjectKey(input.connectionId),
      Body: input.body,
      ContentType: 'application/x-yaml',
    }),
  );
}
```

Run: `npx vitest run tests/unit/aws-template.test.ts`
Expected: 7 passed.

- [ ] **Step 7: Lint a generated template with cfn-lint**

Create `scripts/write-sample-template.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { renderTemplateYaml } from '../src/lib/aws/template';

const out = path.join(process.cwd(), 'tmp', 'opswatch-sample.yaml');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(
  out,
  renderTemplateYaml({
    connectionId: 'abc123def456',
    externalId: 'sample-external-id-0123456789abcdef',
    trust: { principal: 'arn:aws:iam::111122223333:root', principalArnPattern: 'arn:aws:iam::111122223333:role/*opswatch' },
  }),
);
console.log(`wrote ${out}`);
```

Run: `npm run lint:template`
Expected: `wrote .../tmp/opswatch-sample.yaml`, then cfn-lint exits 0 with no output.

- [ ] **Step 8: Commit**

Run: `npm test && npm run typecheck`

```bash
git add -A
git commit -m "feat: generate the read-only CloudFormation template

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Credential resolution for the three connection methods

**Files:**
- Create: `src/lib/aws/errors.ts`, `src/lib/aws/credentials.ts`
- Test: `tests/unit/aws-credentials.test.ts`

**Interfaces:**
- Consumes: `clientConfig` (Task 6).
- Produces:
  - `awsErrorCode(error: unknown): string` (the error `name`, else `'UnknownError'`)
  - `type CredentialsInput = { method: 'role'; connectionId: string; roleArn: string; externalId: string } | { method: 'ambient' } | { method: 'keys'; accessKeyId: string; secretAccessKey: string }`
  - `ASSUME_ROLE_DURATION_SECONDS = 3600`, `REFRESH_WINDOW_MS = 300_000`
  - `type AssumeRoleEvent = { event: 'assume_role'; connectionId: string; ok: boolean; errorCode?: string }`
  - `type CredentialResolver = { resolve(input: CredentialsInput, region: string): Promise<AwsCredentialIdentity>; forget(connectionId: string): void }`
  - `createCredentialResolver(deps?: { now?: () => number; ambientProvider?: AwsCredentialIdentityProvider; log?: (event: AssumeRoleEvent) => void }): CredentialResolver`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/aws-credentials.test.ts`:

```ts
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCredentialResolver, type AssumeRoleEvent } from '@/lib/aws/credentials';

const sts = mockClient(STSClient);
const T0 = Date.parse('2026-09-17T10:00:00Z');
const role = {
  method: 'role' as const,
  connectionId: 'abc123def456',
  roleArn: 'arn:aws:iam::111122223333:role/OpsWatchReadOnly-abc123def456',
  externalId: 'ext-id',
};

function assumeRoleResponse(expiresAt: number) {
  return {
    Credentials: {
      AccessKeyId: 'ASIATEMP',
      SecretAccessKey: 'temp-secret',
      SessionToken: 'temp-token',
      Expiration: new Date(expiresAt),
    },
  };
}

beforeEach(() => sts.reset());

describe('credential resolver', () => {
  it('assumes the role with the ExternalId, session name and duration', async () => {
    sts.on(AssumeRoleCommand).resolves(assumeRoleResponse(T0 + 3_600_000));
    const events: AssumeRoleEvent[] = [];
    const resolver = createCredentialResolver({
      now: () => T0,
      ambientProvider: async () => ({ accessKeyId: 'BASE', secretAccessKey: 'base' }),
      log: (e) => events.push(e),
    });

    const creds = await resolver.resolve(role, 'eu-west-1');

    expect(creds).toEqual({
      accessKeyId: 'ASIATEMP',
      secretAccessKey: 'temp-secret',
      sessionToken: 'temp-token',
      expiration: new Date(T0 + 3_600_000),
    });
    expect(sts.commandCalls(AssumeRoleCommand)[0].args[0].input).toEqual({
      RoleArn: role.roleArn,
      ExternalId: 'ext-id',
      RoleSessionName: 'opswatch-abc123def456',
      DurationSeconds: 3600,
    });
    expect(events).toEqual([{ event: 'assume_role', connectionId: 'abc123def456', ok: true }]);
  });

  it('reuses cached credentials until 5 minutes before expiry', async () => {
    sts.on(AssumeRoleCommand).resolves(assumeRoleResponse(T0 + 3_600_000));
    let now = T0;
    const resolver = createCredentialResolver({
      now: () => now,
      ambientProvider: async () => ({ accessKeyId: 'BASE', secretAccessKey: 'base' }),
      log: () => {},
    });

    await resolver.resolve(role, 'eu-west-1');
    now = T0 + 54 * 60_000; // 6 minutes left
    await resolver.resolve(role, 'eu-west-1');
    expect(sts.commandCalls(AssumeRoleCommand)).toHaveLength(1);

    now = T0 + 56 * 60_000; // 4 minutes left
    await resolver.resolve(role, 'eu-west-1');
    expect(sts.commandCalls(AssumeRoleCommand)).toHaveLength(2);
  });

  it('assumes again after forget() or when the ExternalId changes', async () => {
    sts.on(AssumeRoleCommand).resolves(assumeRoleResponse(T0 + 3_600_000));
    const resolver = createCredentialResolver({
      now: () => T0,
      ambientProvider: async () => ({ accessKeyId: 'BASE', secretAccessKey: 'base' }),
      log: () => {},
    });
    await resolver.resolve(role, 'eu-west-1');
    await resolver.resolve({ ...role, externalId: 'new-ext-id' }, 'eu-west-1');
    resolver.forget('abc123def456');
    await resolver.resolve(role, 'eu-west-1');
    expect(sts.commandCalls(AssumeRoleCommand)).toHaveLength(3);
  });

  it('logs and rethrows a failed AssumeRole without secrets', async () => {
    sts.on(AssumeRoleCommand).rejects(Object.assign(new Error('not authorized'), { name: 'AccessDenied' }));
    const log = vi.fn();
    const resolver = createCredentialResolver({
      now: () => T0,
      ambientProvider: async () => ({ accessKeyId: 'BASE', secretAccessKey: 'base' }),
      log,
    });
    await expect(resolver.resolve(role, 'eu-west-1')).rejects.toMatchObject({ name: 'AccessDenied' });
    expect(log).toHaveBeenCalledWith({
      event: 'assume_role',
      connectionId: 'abc123def456',
      ok: false,
      errorCode: 'AccessDenied',
    });
  });

  it('returns ambient credentials from the provider chain', async () => {
    const resolver = createCredentialResolver({
      ambientProvider: async () => ({ accessKeyId: 'AMBIENT', secretAccessKey: 'amb' }),
    });
    expect(await resolver.resolve({ method: 'ambient' }, 'eu-west-1')).toEqual({
      accessKeyId: 'AMBIENT',
      secretAccessKey: 'amb',
    });
  });

  it('returns static access keys', async () => {
    const resolver = createCredentialResolver({ ambientProvider: async () => ({ accessKeyId: 'x', secretAccessKey: 'y' }) });
    expect(
      await resolver.resolve({ method: 'keys', accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret' }, 'eu-west-1'),
    ).toEqual({ accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret' });
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/unit/aws-credentials.test.ts`
Expected: FAIL, cannot resolve `@/lib/aws/credentials`.

- [ ] **Step 3: Implement `src/lib/aws/errors.ts`**

```ts
export function awsErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error && typeof error.name === 'string' && error.name) {
    return error.name;
  }
  return 'UnknownError';
}
```

- [ ] **Step 4: Implement `src/lib/aws/credentials.ts`**

```ts
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import type { AwsCredentialIdentity, AwsCredentialIdentityProvider } from '@smithy/types';
import { clientConfig } from './client-config';
import { awsErrorCode } from './errors';

export type CredentialsInput =
  | { method: 'role'; connectionId: string; roleArn: string; externalId: string }
  | { method: 'ambient' }
  | { method: 'keys'; accessKeyId: string; secretAccessKey: string };

export const ASSUME_ROLE_DURATION_SECONDS = 3600;
export const REFRESH_WINDOW_MS = 5 * 60_000;

export type AssumeRoleEvent = { event: 'assume_role'; connectionId: string; ok: boolean; errorCode?: string };

export type CredentialResolver = {
  resolve(input: CredentialsInput, region: string): Promise<AwsCredentialIdentity>;
  forget(connectionId: string): void;
};

export function createCredentialResolver(
  deps: {
    now?: () => number;
    ambientProvider?: AwsCredentialIdentityProvider;
    log?: (event: AssumeRoleEvent) => void;
  } = {},
): CredentialResolver {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((event: AssumeRoleEvent) => console.info(JSON.stringify(event)));
  const ambient = deps.ambientProvider ?? fromNodeProviderChain();
  const cache = new Map<string, AwsCredentialIdentity>();

  async function assumeRole(
    input: Extract<CredentialsInput, { method: 'role' }>,
    region: string,
  ): Promise<AwsCredentialIdentity> {
    const key = `${input.connectionId}|${input.roleArn}|${input.externalId}`;
    const cached = cache.get(key);
    if (cached?.expiration && cached.expiration.getTime() - now() > REFRESH_WINDOW_MS) {
      return cached;
    }

    const sts = new STSClient(clientConfig(region, ambient));
    try {
      const out = await sts.send(
        new AssumeRoleCommand({
          RoleArn: input.roleArn,
          ExternalId: input.externalId,
          RoleSessionName: `opswatch-${input.connectionId}`,
          DurationSeconds: ASSUME_ROLE_DURATION_SECONDS,
        }),
      );
      const c = out.Credentials;
      if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken || !c.Expiration) {
        throw Object.assign(new Error('AssumeRole returned incomplete credentials'), { name: 'IncompleteCredentials' });
      }
      const credentials: AwsCredentialIdentity = {
        accessKeyId: c.AccessKeyId,
        secretAccessKey: c.SecretAccessKey,
        sessionToken: c.SessionToken,
        expiration: c.Expiration,
      };
      cache.set(key, credentials);
      log({ event: 'assume_role', connectionId: input.connectionId, ok: true });
      return credentials;
    } catch (error) {
      log({ event: 'assume_role', connectionId: input.connectionId, ok: false, errorCode: awsErrorCode(error) });
      throw error;
    }
  }

  return {
    async resolve(input, region) {
      switch (input.method) {
        case 'keys':
          return { accessKeyId: input.accessKeyId, secretAccessKey: input.secretAccessKey };
        case 'ambient':
          return ambient();
        case 'role':
          return assumeRole(input, region);
      }
    },
    forget(connectionId) {
      for (const key of [...cache.keys()]) {
        if (key.startsWith(`${connectionId}|`)) {
          cache.delete(key);
        }
      }
    },
  };
}
```

- [ ] **Step 5: Run the tests and commit**

Run: `npx vitest run tests/unit/aws-credentials.test.ts`
Expected: 6 passed.

Run: `npm test && npm run typecheck`

```bash
git add -A
git commit -m "feat: resolve AWS credentials by role, ambient chain or access keys

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Per-service permission test

**Files:**
- Create: `src/lib/aws/permissions.ts`
- Test: `tests/unit/aws-permissions.test.ts`

**Interfaces:**
- Consumes: `clientConfig`, `getCallerIdentity` (Task 6); `awsErrorCode` (Task 7); `ServiceCheck`, `PermissionTestResult`, `OverallStatus` (Task 3).
- Produces:
  - `CHECK_TIMEOUT_MS = 5000`
  - `type PermissionTestInput = { expectedAccountId: string; regions: string[]; credentials: AwsCredentialIdentity; timeoutMs?: number; now?: () => Date }`
  - `classifyError(error: unknown): { status: 'denied' | 'error'; errorCode: string }`
  - `overallStatus(accountMatches: boolean, checks: ServiceCheck[]): OverallStatus`
  - `runPermissionTest(input: PermissionTestInput): Promise<PermissionTestResult>`
  - Check order per region: `ecs`, `elb`, `rds`, `pi`, `cloudwatch`, `logs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/aws-permissions.test.ts`:

```ts
import { CloudWatchClient, ListMetricsCommand } from '@aws-sdk/client-cloudwatch';
import { CloudWatchLogsClient, DescribeLogGroupsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { ECSClient, ListClustersCommand } from '@aws-sdk/client-ecs';
import { DescribeLoadBalancersCommand, ElasticLoadBalancingV2Client } from '@aws-sdk/client-elastic-load-balancing-v2';
import { ListAvailableResourceMetricsCommand, PIClient } from '@aws-sdk/client-pi';
import { DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { classifyError, overallStatus, runPermissionTest } from '@/lib/aws/permissions';
import type { ServiceCheck } from '@/lib/connections/types';

const sts = mockClient(STSClient);
const ecs = mockClient(ECSClient);
const elb = mockClient(ElasticLoadBalancingV2Client);
const rds = mockClient(RDSClient);
const pi = mockClient(PIClient);
const cw = mockClient(CloudWatchClient);
const logs = mockClient(CloudWatchLogsClient);

const credentials = { accessKeyId: 'ASIA', secretAccessKey: 's', sessionToken: 't' };
const now = () => new Date('2026-09-17T10:00:00Z');
const denied = (name = 'AccessDeniedException') => Object.assign(new Error('denied'), { name });

function allowEverything() {
  sts.on(GetCallerIdentityCommand).resolves({ Account: '111122223333', Arn: 'arn:aws:sts::111122223333:assumed-role/OpsWatchReadOnly-x/s' });
  ecs.on(ListClustersCommand).resolves({ clusterArns: [] });
  elb.on(DescribeLoadBalancersCommand).resolves({ LoadBalancers: [] });
  rds.on(DescribeDBInstancesCommand).resolves({
    DBInstances: [{ DBInstanceIdentifier: 'db-1', PerformanceInsightsEnabled: true, DbiResourceId: 'db-ABC' }],
  });
  pi.on(ListAvailableResourceMetricsCommand).resolves({ Metrics: [] });
  cw.on(ListMetricsCommand).resolves({ Metrics: [] });
  logs.on(DescribeLogGroupsCommand).resolves({ logGroups: [] });
}

beforeEach(() => {
  for (const m of [sts, ecs, elb, rds, pi, cw, logs]) m.reset();
});

describe('classifyError', () => {
  it('maps access errors to denied and the rest to error', () => {
    expect(classifyError(denied('AccessDenied'))).toEqual({ status: 'denied', errorCode: 'AccessDenied' });
    expect(classifyError(denied('UnauthorizedOperation'))).toEqual({ status: 'denied', errorCode: 'UnauthorizedOperation' });
    expect(classifyError(denied('ThrottlingException'))).toEqual({ status: 'error', errorCode: 'ThrottlingException' });
    expect(classifyError(denied('TimeoutError'))).toEqual({ status: 'error', errorCode: 'Timeout' });
  });
});

describe('overallStatus', () => {
  const check = (status: ServiceCheck['status']): ServiceCheck => ({
    service: 'ecs', region: 'eu-west-1', action: 'ecs:ListClusters', status, checkedAt: '',
  });
  it('is ok, degraded or failed', () => {
    expect(overallStatus(true, [check('ok'), check('not_applicable')])).toBe('ok');
    expect(overallStatus(true, [check('ok'), check('denied')])).toBe('degraded');
    expect(overallStatus(true, [check('denied'), check('error'), check('not_applicable')])).toBe('failed');
    expect(overallStatus(false, [check('ok')])).toBe('failed');
  });
});

describe('runPermissionTest', () => {
  it('reports every service ok, in order, for each region', async () => {
    allowEverything();
    const result = await runPermissionTest({ expectedAccountId: '111122223333', regions: ['eu-west-1', 'us-east-1'], credentials, now });
    expect(result.overall).toBe('ok');
    expect(result.accountMatches).toBe(true);
    expect(result.checks.map((c) => `${c.region}:${c.service}:${c.status}`)).toEqual([
      'eu-west-1:ecs:ok', 'eu-west-1:elb:ok', 'eu-west-1:rds:ok', 'eu-west-1:pi:ok', 'eu-west-1:cloudwatch:ok', 'eu-west-1:logs:ok',
      'us-east-1:ecs:ok', 'us-east-1:elb:ok', 'us-east-1:rds:ok', 'us-east-1:pi:ok', 'us-east-1:cloudwatch:ok', 'us-east-1:logs:ok',
    ]);
    expect(pi.commandCalls(ListAvailableResourceMetricsCommand)[0].args[0].input).toMatchObject({ ServiceType: 'RDS', Identifier: 'db-ABC' });
    expect(result.testedAt).toBe('2026-09-17T10:00:00.000Z');
  });

  it('is degraded when one service is denied and names the action', async () => {
    allowEverything();
    logs.on(DescribeLogGroupsCommand).rejects(denied());
    const result = await runPermissionTest({ expectedAccountId: '111122223333', regions: ['eu-west-1'], credentials, now });
    expect(result.overall).toBe('degraded');
    expect(result.checks.find((c) => c.service === 'logs')).toMatchObject({
      status: 'denied', action: 'logs:DescribeLogGroups', errorCode: 'AccessDeniedException',
    });
  });

  it('marks Performance Insights not applicable when no instance has it', async () => {
    allowEverything();
    rds.on(DescribeDBInstancesCommand).resolves({ DBInstances: [{ DBInstanceIdentifier: 'db-1', PerformanceInsightsEnabled: false }] });
    const result = await runPermissionTest({ expectedAccountId: '111122223333', regions: ['eu-west-1'], credentials, now });
    expect(result.checks.find((c) => c.service === 'pi')?.status).toBe('not_applicable');
    expect(pi.commandCalls(ListAvailableResourceMetricsCommand)).toHaveLength(0);
  });

  it('fails without calling services when the account does not match', async () => {
    allowEverything();
    const result = await runPermissionTest({ expectedAccountId: '999999999999', regions: ['eu-west-1'], credentials, now });
    expect(result).toMatchObject({ overall: 'failed', accountMatches: false, identityError: 'AccountMismatch', checks: [] });
    expect(ecs.commandCalls(ListClustersCommand)).toHaveLength(0);
  });

  it('fails when the identity call itself fails', async () => {
    sts.on(GetCallerIdentityCommand).rejects(denied('InvalidClientTokenId'));
    const result = await runPermissionTest({ expectedAccountId: '111122223333', regions: ['eu-west-1'], credentials, now });
    expect(result).toMatchObject({ overall: 'failed', identityError: 'InvalidClientTokenId', checks: [] });
  });

  it('times out a hanging call', async () => {
    allowEverything();
    ecs.on(ListClustersCommand).callsFake(() => new Promise(() => {}));
    const result = await runPermissionTest({
      expectedAccountId: '111122223333', regions: ['eu-west-1'], credentials, now, timeoutMs: 30,
    });
    expect(result.checks.find((c) => c.service === 'ecs')).toMatchObject({ status: 'error', errorCode: 'Timeout' });
    expect(result.overall).toBe('degraded');
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/unit/aws-permissions.test.ts`
Expected: FAIL, cannot resolve `@/lib/aws/permissions`.

- [ ] **Step 3: Implement `src/lib/aws/permissions.ts`**

```ts
import { CloudWatchClient, ListMetricsCommand } from '@aws-sdk/client-cloudwatch';
import { CloudWatchLogsClient, DescribeLogGroupsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { ECSClient, ListClustersCommand } from '@aws-sdk/client-ecs';
import { DescribeLoadBalancersCommand, ElasticLoadBalancingV2Client } from '@aws-sdk/client-elastic-load-balancing-v2';
import { ListAvailableResourceMetricsCommand, PIClient } from '@aws-sdk/client-pi';
import { DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';
import type { AwsCredentialIdentity } from '@smithy/types';
import type { CheckedService, OverallStatus, PermissionTestResult, ServiceCheck } from '../connections/types';
import { clientConfig } from './client-config';
import { awsErrorCode } from './errors';
import { getCallerIdentity } from './identity';

export const CHECK_TIMEOUT_MS = 5000;

export type PermissionTestInput = {
  expectedAccountId: string;
  regions: string[];
  credentials: AwsCredentialIdentity;
  timeoutMs?: number;
  now?: () => Date;
};

const DENIED = /^(AccessDenied|UnauthorizedOperation|AuthorizationError|NotAuthorized)/;

export function classifyError(error: unknown): { status: 'denied' | 'error'; errorCode: string } {
  const code = awsErrorCode(error);
  if (code === 'TimeoutError' || code === 'AbortError') {
    return { status: 'error', errorCode: 'Timeout' };
  }
  return DENIED.test(code) ? { status: 'denied', errorCode: code } : { status: 'error', errorCode: code };
}

export function overallStatus(accountMatches: boolean, checks: ServiceCheck[]): OverallStatus {
  if (!accountMatches) {
    return 'failed';
  }
  const relevant = checks.filter((c) => c.status !== 'not_applicable');
  const failing = relevant.filter((c) => c.status !== 'ok');
  if (relevant.length === 0 || failing.length === relevant.length) {
    return 'failed';
  }
  return failing.length === 0 ? 'ok' : 'degraded';
}

function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error(`Timed out after ${timeoutMs} ms`), { name: 'TimeoutError' }));
    }, timeoutMs);
  });
  return Promise.race([run(controller.signal), timeout]).finally(() => clearTimeout(timer));
}

async function check(
  service: CheckedService,
  action: string,
  region: string,
  checkedAt: string,
  timeoutMs: number,
  call: (signal: AbortSignal) => Promise<unknown>,
): Promise<ServiceCheck> {
  try {
    await withTimeout(call, timeoutMs);
    return { service, region, action, status: 'ok', checkedAt };
  } catch (error) {
    return { service, region, action, checkedAt, ...classifyError(error) };
  }
}

async function checkRegion(
  region: string,
  credentials: AwsCredentialIdentity,
  timeoutMs: number,
  checkedAt: string,
): Promise<ServiceCheck[]> {
  const config = clientConfig(region, credentials);
  let piIdentifier: string | undefined;

  const [ecs, elb, rds, cloudwatch, logs] = await Promise.all([
    check('ecs', 'ecs:ListClusters', region, checkedAt, timeoutMs, (abortSignal) =>
      new ECSClient(config).send(new ListClustersCommand({ maxResults: 1 }), { abortSignal }),
    ),
    check('elb', 'elasticloadbalancing:DescribeLoadBalancers', region, checkedAt, timeoutMs, (abortSignal) =>
      new ElasticLoadBalancingV2Client(config).send(new DescribeLoadBalancersCommand({ PageSize: 1 }), { abortSignal }),
    ),
    check('rds', 'rds:DescribeDBInstances', region, checkedAt, timeoutMs, async (abortSignal) => {
      const out = await new RDSClient(config).send(new DescribeDBInstancesCommand({ MaxRecords: 20 }), { abortSignal });
      piIdentifier = out.DBInstances?.find((i) => i.PerformanceInsightsEnabled && i.DbiResourceId)?.DbiResourceId;
    }),
    check('cloudwatch', 'cloudwatch:ListMetrics', region, checkedAt, timeoutMs, (abortSignal) =>
      new CloudWatchClient(config).send(new ListMetricsCommand({ Namespace: 'AWS/ECS' }), { abortSignal }),
    ),
    check('logs', 'logs:DescribeLogGroups', region, checkedAt, timeoutMs, (abortSignal) =>
      new CloudWatchLogsClient(config).send(new DescribeLogGroupsCommand({ limit: 1 }), { abortSignal }),
    ),
  ]);

  // Copied into a const so TypeScript keeps the narrowing inside the callback.
  const identifier: string | undefined = piIdentifier;
  const pi: ServiceCheck =
    rds.status === 'ok' && identifier
      ? await check('pi', 'pi:ListAvailableResourceMetrics', region, checkedAt, timeoutMs, (abortSignal) =>
          new PIClient(config).send(
            new ListAvailableResourceMetricsCommand({ ServiceType: 'RDS', Identifier: identifier, MetricTypes: ['os'] }),
            { abortSignal },
          ),
        )
      : { service: 'pi', region, action: 'pi:ListAvailableResourceMetrics', status: 'not_applicable', checkedAt };

  return [ecs, elb, rds, pi, cloudwatch, logs];
}

export async function runPermissionTest(input: PermissionTestInput): Promise<PermissionTestResult> {
  const testedAt = (input.now ?? (() => new Date()))().toISOString();
  const timeoutMs = input.timeoutMs ?? CHECK_TIMEOUT_MS;

  let identity;
  try {
    identity = await getCallerIdentity(input.credentials, input.regions[0]);
  } catch (error) {
    return { overall: 'failed', accountMatches: false, identityError: awsErrorCode(error), checks: [], testedAt };
  }

  if (identity.account !== input.expectedAccountId) {
    return {
      overall: 'failed',
      accountMatches: false,
      identityArn: identity.arn,
      identityError: 'AccountMismatch',
      checks: [],
      testedAt,
    };
  }

  const perRegion = await Promise.all(
    input.regions.map((region) => checkRegion(region, input.credentials, timeoutMs, testedAt)),
  );
  const checks = perRegion.flat();
  return { overall: overallStatus(true, checks), accountMatches: true, identityArn: identity.arn, checks, testedAt };
}
```

- [ ] **Step 4: Run the tests and commit**

Run: `npx vitest run tests/unit/aws-permissions.test.ts`
Expected: 8 passed.

Run: `npm test && npm run typecheck`

```bash
git add -A
git commit -m "feat: test AWS permissions service by service

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Connections repository, connection test service and origin check

**Files:**
- Create: `src/lib/connections/validation.ts`, `src/lib/connections/repository.ts`, `src/lib/connections/test-connection.ts`, `src/lib/connections/resolver.ts`, `src/lib/http/origin.ts`
- Test: `tests/unit/connections-repository.test.ts`, `tests/unit/test-connection.test.ts`, `tests/unit/origin.test.ts`

**Interfaces:**
- Consumes: `Db`, `connections`, `ConnectionRow` (Task 3); `encrypt`, `decrypt`, `DecryptionError`, `randomId`, `randomToken` (Task 2); `TEMPLATE_VERSION` (Task 6); `roleNameFor` (Task 6); `CredentialsInput`, `CredentialResolver`, `createCredentialResolver` (Task 7); `awsErrorCode` (Task 7); `runPermissionTest`, `PermissionTestInput` (Task 8).
- Produces:
  - `AWS_REGIONS` (readonly tuple of region codes), `type AwsRegion`
  - `parseRoleArn(arn: string): { account: string; roleName: string } | null`
  - `class ConnectionNotFoundError extends Error`
  - `type ConnectionInputErrorCode = 'name_invalid' | 'account_invalid' | 'regions_invalid' | 'method_invalid' | 'role_arn_invalid' | 'role_arn_account_mismatch' | 'role_arn_wrong_role' | 'keys_invalid' | 'wrong_method' | 'not_ready'`
  - `class ConnectionInputError extends Error { code: ConnectionInputErrorCode }`
  - `createConnection(db: Db, input: { name: string; method: string; awsAccountId: string; regions: string[] }, now?: Date): ConnectionRow`
  - `listConnections(db: Db): ConnectionRow[]`, `getConnection(db: Db, id: string): ConnectionRow`
  - `setRoleArn(db: Db, id: string, roleArn: string, now?: Date): ConnectionRow`
  - `setAccessKeys(db: Db, id: string, input: { accessKeyId: string; secretAccessKey: string }, secret: string, now?: Date): ConnectionRow`
  - `regenerateExternalId(db: Db, id: string, now?: Date): ConnectionRow`
  - `saveTestResult(db: Db, id: string, result: PermissionTestResult, now?: Date): ConnectionRow`
  - `deleteConnection(db: Db, id: string): void`
  - `readAccessKeys(row: ConnectionRow, secret: string): { accessKeyId: string; secretAccessKey: string }`
  - `credentialsInputFor(row: ConnectionRow, secret: string): CredentialsInput`
  - `type ConnectionView = { id; name; method; awsAccountId; regions; roleArn: string | null; externalId: string | null; templateOutdated: boolean; accessKeyHint: string | null; keysUnreadable: boolean; status; lastTest: PermissionTestResult | null; updatedAt: Date }`
  - `toView(row: ConnectionRow, secret: string): ConnectionView`
  - `testConnection(db: Db, id: string, deps: { secret: string; resolver: CredentialResolver; runTest?: (input: PermissionTestInput) => Promise<PermissionTestResult>; now?: () => Date }): Promise<PermissionTestResult>`
  - `credentialResolver: CredentialResolver` (process-wide singleton)
  - `isSameOrigin(request: Request, publicUrl?: string): boolean`

- [ ] **Step 1: Write the failing repository test**

Create `tests/unit/connections-repository.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TEMPLATE_VERSION } from '@/lib/aws/actions';
import { DecryptionError } from '@/lib/crypto';
import {
  ConnectionInputError,
  ConnectionNotFoundError,
  createConnection,
  credentialsInputFor,
  deleteConnection,
  getConnection,
  listConnections,
  readAccessKeys,
  regenerateExternalId,
  saveTestResult,
  setAccessKeys,
  setRoleArn,
  toView,
} from '@/lib/connections/repository';
import { parseRoleArn } from '@/lib/connections/validation';
import { createTestDb } from '../helpers/db';

const SECRET = 'k'.repeat(32);
const now = new Date('2026-09-17T10:00:00Z');
const base = { name: 'production', awsAccountId: '111122223333', regions: ['eu-west-1'] };

describe('parseRoleArn', () => {
  it('extracts account and role name, with or without a path', () => {
    expect(parseRoleArn('arn:aws:iam::111122223333:role/OpsWatchReadOnly-abc')).toEqual({
      account: '111122223333',
      roleName: 'OpsWatchReadOnly-abc',
    });
    expect(parseRoleArn('arn:aws:iam::111122223333:role/team/OpsWatchReadOnly-abc')?.roleName).toBe('OpsWatchReadOnly-abc');
    expect(parseRoleArn('arn:aws:iam::111122223333:user/bob')).toBeNull();
    expect(parseRoleArn('nonsense')).toBeNull();
  });
});

describe('connections repository', () => {
  it('creates a role connection as a draft with an ExternalId and template version', () => {
    const db = createTestDb();
    const row = createConnection(db, { ...base, method: 'role' }, now);
    expect(row.id).toMatch(/^[0-9a-f]{12}$/);
    expect(row.status).toBe('draft');
    expect(Buffer.from(row.externalId ?? '', 'base64url')).toHaveLength(32);
    expect(row.templateVersion).toBe(TEMPLATE_VERSION);
    expect(listConnections(db).map((c) => c.id)).toEqual([row.id]);
  });

  it('creates an ambient connection ready to test and a keys connection as draft', () => {
    const db = createTestDb();
    expect(createConnection(db, { ...base, method: 'ambient' }, now).status).toBe('pending');
    const keys = createConnection(db, { ...base, method: 'keys' }, now);
    expect(keys.status).toBe('draft');
    expect(keys.externalId).toBeNull();
  });

  it('validates the connection input', () => {
    const db = createTestDb();
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return (error as ConnectionInputError).code;
      }
    };
    expect(code(() => createConnection(db, { ...base, name: ' ', method: 'role' }))).toBe('name_invalid');
    expect(code(() => createConnection(db, { ...base, awsAccountId: '123', method: 'role' }))).toBe('account_invalid');
    expect(code(() => createConnection(db, { ...base, regions: [], method: 'role' }))).toBe('regions_invalid');
    expect(code(() => createConnection(db, { ...base, regions: ['mars-1'], method: 'role' }))).toBe('regions_invalid');
    expect(code(() => createConnection(db, { ...base, method: 'magic' }))).toBe('method_invalid');
  });

  it('accepts only the matching OpsWatch role ARN', () => {
    const db = createTestDb();
    const row = createConnection(db, { ...base, method: 'role' }, now);
    const code = (arn: string) => {
      try {
        setRoleArn(db, row.id, arn, now);
      } catch (error) {
        return (error as ConnectionInputError).code;
      }
    };
    expect(code('not-an-arn')).toBe('role_arn_invalid');
    expect(code(`arn:aws:iam::999999999999:role/OpsWatchReadOnly-${row.id}`)).toBe('role_arn_account_mismatch');
    expect(code('arn:aws:iam::111122223333:role/OpsWatchReadOnly-otherid')).toBe('role_arn_wrong_role');

    const updated = setRoleArn(db, row.id, `arn:aws:iam::111122223333:role/OpsWatchReadOnly-${row.id}`, now);
    expect(updated.status).toBe('pending');
    expect(credentialsInputFor(updated, SECRET)).toEqual({
      method: 'role',
      connectionId: row.id,
      roleArn: `arn:aws:iam::111122223333:role/OpsWatchReadOnly-${row.id}`,
      externalId: row.externalId,
    });
  });

  it('encrypts access keys and never exposes them in the view', () => {
    const db = createTestDb();
    const row = createConnection(db, { ...base, method: 'keys' }, now);
    const keys = { accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
    const updated = setAccessKeys(db, row.id, keys, SECRET, now);

    expect(updated.status).toBe('pending');
    expect(updated.accessKeyCiphertext).not.toContain('AKIA');
    expect(readAccessKeys(updated, SECRET)).toEqual(keys);

    const view = toView(updated, SECRET);
    expect(view.accessKeyHint).toBe('AKIA…MNOP');
    expect(JSON.stringify(view)).not.toContain(keys.secretAccessKey);
    expect(JSON.stringify(view)).not.toContain('accessKeyCiphertext');

    expect(toView(updated, 'z'.repeat(32))).toMatchObject({ accessKeyHint: null, keysUnreadable: true });
    expect(() => readAccessKeys(updated, 'z'.repeat(32))).toThrow(DecryptionError);
  });

  it('rejects malformed keys and keys on a role connection', () => {
    const db = createTestDb();
    const keysRow = createConnection(db, { ...base, method: 'keys' }, now);
    const roleRow = createConnection(db, { ...base, method: 'role' }, now);
    expect(() => setAccessKeys(db, keysRow.id, { accessKeyId: 'nope', secretAccessKey: 'x' }, SECRET)).toThrow(
      ConnectionInputError,
    );
    expect(() =>
      setAccessKeys(db, roleRow.id, { accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey: 'x'.repeat(40) }, SECRET),
    ).toThrow(expect.objectContaining({ code: 'wrong_method' }));
  });

  it('refuses credentials for a connection that is not ready', () => {
    const db = createTestDb();
    const row = createConnection(db, { ...base, method: 'role' }, now);
    expect(() => credentialsInputFor(row, SECRET)).toThrow(expect.objectContaining({ code: 'not_ready' }));
  });

  it('regenerates the ExternalId and resets the test state', () => {
    const db = createTestDb();
    const row = createConnection(db, { ...base, method: 'role' }, now);
    setRoleArn(db, row.id, `arn:aws:iam::111122223333:role/OpsWatchReadOnly-${row.id}`, now);
    saveTestResult(db, row.id, { overall: 'ok', accountMatches: true, checks: [], testedAt: now.toISOString() }, now);

    const regenerated = regenerateExternalId(db, row.id, now);
    expect(regenerated.externalId).not.toBe(row.externalId);
    expect(regenerated.status).toBe('pending');
    expect(regenerated.lastTest).toBeNull();
  });

  it('stores a test result and derives the status', () => {
    const db = createTestDb();
    const row = createConnection(db, { ...base, method: 'ambient' }, now);
    const saved = saveTestResult(
      db,
      row.id,
      { overall: 'degraded', accountMatches: true, checks: [], testedAt: now.toISOString() },
      now,
    );
    expect(saved.status).toBe('degraded');
    expect(saved.lastTest?.overall).toBe('degraded');
  });

  it('flags outdated templates and deletes connections', () => {
    const db = createTestDb();
    const row = createConnection(db, { ...base, method: 'role' }, now);
    expect(toView({ ...row, templateVersion: TEMPLATE_VERSION - 1 }, SECRET).templateOutdated).toBe(true);
    deleteConnection(db, row.id);
    expect(() => getConnection(db, row.id)).toThrow(ConnectionNotFoundError);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/unit/connections-repository.test.ts`
Expected: FAIL, cannot resolve `@/lib/connections/repository`.

- [ ] **Step 3: Implement `src/lib/connections/validation.ts`**

```ts
import { z } from 'zod';
import { CONNECTION_METHODS } from './types';

export const AWS_REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'ca-central-1', 'sa-east-1',
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-central-2', 'eu-north-1', 'eu-south-1', 'eu-south-2',
  'me-south-1', 'me-central-1', 'il-central-1', 'af-south-1',
  'ap-south-1', 'ap-south-2', 'ap-east-1',
  'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3',
  'ap-southeast-1', 'ap-southeast-2', 'ap-southeast-3', 'ap-southeast-4',
] as const;
export type AwsRegion = (typeof AWS_REGIONS)[number];

export const nameSchema = z.string().trim().min(1).max(80);
export const accountIdSchema = z.string().regex(/^\d{12}$/);
export const regionsSchema = z.array(z.enum(AWS_REGIONS)).min(1);
export const methodSchema = z.enum(CONNECTION_METHODS);
export const accessKeysSchema = z.object({
  accessKeyId: z.string().regex(/^(AKIA|ASIA)[A-Z0-9]{16}$/),
  secretAccessKey: z.string().min(30).max(128),
});

const ROLE_ARN = /^arn:aws[\w-]*:iam::(\d{12}):role\/(?:[\w+=,.@-]+\/)*([\w+=,.@-]+)$/;

export function parseRoleArn(arn: string): { account: string; roleName: string } | null {
  const match = arn.trim().match(ROLE_ARN);
  return match ? { account: match[1], roleName: match[2] } : null;
}
```

- [ ] **Step 4: Implement `src/lib/connections/repository.ts`**

```ts
import { desc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { TEMPLATE_VERSION } from '../aws/actions';
import type { CredentialsInput } from '../aws/credentials';
import { roleNameFor } from '../aws/template';
import { DecryptionError, decrypt, encrypt, randomId, randomToken } from '../crypto';
import type { Db } from '../db/client';
import { connections, type ConnectionRow } from '../db/schema';
import type { ConnectionMethod, ConnectionStatus, PermissionTestResult } from './types';
import {
  accessKeysSchema,
  accountIdSchema,
  methodSchema,
  nameSchema,
  parseRoleArn,
  regionsSchema,
} from './validation';

export class ConnectionNotFoundError extends Error {
  constructor(id: string) {
    super(`Connection ${id} not found`);
    this.name = 'ConnectionNotFoundError';
  }
}

export type ConnectionInputErrorCode =
  | 'name_invalid'
  | 'account_invalid'
  | 'regions_invalid'
  | 'method_invalid'
  | 'role_arn_invalid'
  | 'role_arn_account_mismatch'
  | 'role_arn_wrong_role'
  | 'keys_invalid'
  | 'wrong_method'
  | 'not_ready';

export class ConnectionInputError extends Error {
  constructor(public readonly code: ConnectionInputErrorCode) {
    super(code);
    this.name = 'ConnectionInputError';
  }
}

export type ConnectionView = {
  id: string;
  name: string;
  method: ConnectionMethod;
  awsAccountId: string;
  regions: string[];
  roleArn: string | null;
  externalId: string | null;
  templateOutdated: boolean;
  accessKeyHint: string | null;
  keysUnreadable: boolean;
  status: ConnectionStatus;
  lastTest: PermissionTestResult | null;
  updatedAt: Date;
};

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, code: ConnectionInputErrorCode): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ConnectionInputError(code);
  }
  return parsed.data;
}

export function createConnection(
  db: Db,
  input: { name: string; method: string; awsAccountId: string; regions: string[] },
  now: Date = new Date(),
): ConnectionRow {
  const name = parseOrThrow(nameSchema, input.name, 'name_invalid');
  const method = parseOrThrow(methodSchema, input.method, 'method_invalid');
  const awsAccountId = parseOrThrow(accountIdSchema, input.awsAccountId, 'account_invalid');
  const regions = parseOrThrow(regionsSchema, input.regions, 'regions_invalid');

  return db
    .insert(connections)
    .values({
      id: randomId(),
      name,
      method,
      awsAccountId,
      regions,
      externalId: method === 'role' ? randomToken(32) : null,
      templateVersion: method === 'role' ? TEMPLATE_VERSION : null,
      status: method === 'ambient' ? 'pending' : 'draft',
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

export function listConnections(db: Db): ConnectionRow[] {
  return db.select().from(connections).orderBy(desc(connections.createdAt)).all();
}

export function getConnection(db: Db, id: string): ConnectionRow {
  const row = db.select().from(connections).where(eq(connections.id, id)).get();
  if (!row) {
    throw new ConnectionNotFoundError(id);
  }
  return row;
}

function update(db: Db, id: string, values: Partial<ConnectionRow>, now: Date): ConnectionRow {
  const row = db
    .update(connections)
    .set({ ...values, updatedAt: now })
    .where(eq(connections.id, id))
    .returning()
    .get();
  if (!row) {
    throw new ConnectionNotFoundError(id);
  }
  return row;
}

export function setRoleArn(db: Db, id: string, roleArn: string, now: Date = new Date()): ConnectionRow {
  const row = getConnection(db, id);
  if (row.method !== 'role') {
    throw new ConnectionInputError('wrong_method');
  }
  const parsed = parseRoleArn(roleArn);
  if (!parsed) {
    throw new ConnectionInputError('role_arn_invalid');
  }
  if (parsed.account !== row.awsAccountId) {
    throw new ConnectionInputError('role_arn_account_mismatch');
  }
  if (parsed.roleName !== roleNameFor(row.id)) {
    throw new ConnectionInputError('role_arn_wrong_role');
  }
  return update(db, id, { roleArn: roleArn.trim(), status: 'pending', lastTest: null }, now);
}

export function setAccessKeys(
  db: Db,
  id: string,
  input: { accessKeyId: string; secretAccessKey: string },
  secret: string,
  now: Date = new Date(),
): ConnectionRow {
  const row = getConnection(db, id);
  if (row.method !== 'keys') {
    throw new ConnectionInputError('wrong_method');
  }
  const keys = parseOrThrow(
    accessKeysSchema,
    { accessKeyId: input.accessKeyId.trim(), secretAccessKey: input.secretAccessKey.trim() },
    'keys_invalid',
  );
  return update(
    db,
    id,
    { accessKeyCiphertext: encrypt(JSON.stringify(keys), secret), status: 'pending', lastTest: null },
    now,
  );
}

export function regenerateExternalId(db: Db, id: string, now: Date = new Date()): ConnectionRow {
  const row = getConnection(db, id);
  if (row.method !== 'role') {
    throw new ConnectionInputError('wrong_method');
  }
  return update(
    db,
    id,
    {
      externalId: randomToken(32),
      templateVersion: TEMPLATE_VERSION,
      status: row.roleArn ? 'pending' : 'draft',
      lastTest: null,
    },
    now,
  );
}

export function saveTestResult(db: Db, id: string, result: PermissionTestResult, now: Date = new Date()): ConnectionRow {
  return update(db, id, { lastTest: result, status: result.overall }, now);
}

export function deleteConnection(db: Db, id: string): void {
  db.delete(connections).where(eq(connections.id, id)).run();
}

export function readAccessKeys(row: ConnectionRow, secret: string): { accessKeyId: string; secretAccessKey: string } {
  if (!row.accessKeyCiphertext) {
    throw new ConnectionInputError('not_ready');
  }
  return JSON.parse(decrypt(row.accessKeyCiphertext, secret)) as { accessKeyId: string; secretAccessKey: string };
}

export function credentialsInputFor(row: ConnectionRow, secret: string): CredentialsInput {
  switch (row.method) {
    case 'ambient':
      return { method: 'ambient' };
    case 'keys':
      return { method: 'keys', ...readAccessKeys(row, secret) };
    case 'role':
      if (!row.roleArn || !row.externalId) {
        throw new ConnectionInputError('not_ready');
      }
      return { method: 'role', connectionId: row.id, roleArn: row.roleArn, externalId: row.externalId };
  }
}

export function toView(row: ConnectionRow, secret: string): ConnectionView {
  let accessKeyHint: string | null = null;
  let keysUnreadable = false;
  if (row.accessKeyCiphertext) {
    try {
      const { accessKeyId } = readAccessKeys(row, secret);
      accessKeyHint = `${accessKeyId.slice(0, 4)}…${accessKeyId.slice(-4)}`;
    } catch (error) {
      if (!(error instanceof DecryptionError)) {
        throw error;
      }
      keysUnreadable = true;
    }
  }
  return {
    id: row.id,
    name: row.name,
    method: row.method,
    awsAccountId: row.awsAccountId,
    regions: row.regions,
    roleArn: row.roleArn,
    externalId: row.externalId,
    templateOutdated: row.method === 'role' && (row.templateVersion ?? 0) < TEMPLATE_VERSION,
    accessKeyHint,
    keysUnreadable,
    status: row.status,
    lastTest: row.lastTest,
    updatedAt: row.updatedAt,
  };
}
```

- [ ] **Step 5: Run the repository tests**

Run: `npx vitest run tests/unit/connections-repository.test.ts`
Expected: 11 passed.

- [ ] **Step 6: Write the failing connection-test service test**

Create `tests/unit/test-connection.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { CredentialResolver } from '@/lib/aws/credentials';
import { createConnection, getConnection, setAccessKeys, setRoleArn } from '@/lib/connections/repository';
import { testConnection } from '@/lib/connections/test-connection';
import type { PermissionTestResult } from '@/lib/connections/types';
import { createTestDb } from '../helpers/db';

const SECRET = 'k'.repeat(32);
const now = () => new Date('2026-09-17T10:00:00Z');
const base = { name: 'prod', awsAccountId: '111122223333', regions: ['eu-west-1', 'us-east-1'] };
const temp = { accessKeyId: 'ASIA', secretAccessKey: 's', sessionToken: 't' };
const okResult: PermissionTestResult = { overall: 'ok', accountMatches: true, checks: [], testedAt: now().toISOString() };

function resolver(impl: CredentialResolver['resolve']): CredentialResolver {
  return { resolve: vi.fn(impl), forget: vi.fn() };
}

describe('testConnection', () => {
  it('resolves credentials in the first region, runs the test and saves the result', async () => {
    const db = createTestDb();
    const row = createConnection(db, { ...base, method: 'role' }, now());
    setRoleArn(db, row.id, `arn:aws:iam::111122223333:role/OpsWatchReadOnly-${row.id}`, now());
    const r = resolver(async () => temp);
    const runTest = vi.fn(async () => okResult);

    const result = await testConnection(db, row.id, { secret: SECRET, resolver: r, runTest, now });

    expect(result).toEqual(okResult);
    expect(r.resolve).toHaveBeenCalledWith(expect.objectContaining({ method: 'role' }), 'eu-west-1');
    expect(runTest).toHaveBeenCalledWith({
      expectedAccountId: '111122223333',
      regions: ['eu-west-1', 'us-east-1'],
      credentials: temp,
      now,
    });
    expect(getConnection(db, row.id).status).toBe('ok');
  });

  it('records a failed AssumeRole as a failed test', async () => {
    const db = createTestDb();
    const row = createConnection(db, { ...base, method: 'role' }, now());
    setRoleArn(db, row.id, `arn:aws:iam::111122223333:role/OpsWatchReadOnly-${row.id}`, now());
    const r = resolver(async () => {
      throw Object.assign(new Error('nope'), { name: 'AccessDenied' });
    });

    const result = await testConnection(db, row.id, { secret: SECRET, resolver: r, runTest: vi.fn(), now });

    expect(result).toMatchObject({ overall: 'failed', identityError: 'AccessDenied', checks: [] });
    expect(getConnection(db, row.id).status).toBe('failed');
  });

  it('reports keys that can no longer be decrypted', async () => {
    const db = createTestDb();
    const row = createConnection(db, { ...base, method: 'keys' }, now());
    setAccessKeys(db, row.id, { accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey: 'x'.repeat(40) }, SECRET, now());

    const result = await testConnection(db, row.id, {
      secret: 'o'.repeat(32),
      resolver: resolver(async () => temp),
      runTest: vi.fn(),
      now,
    });

    expect(result).toMatchObject({ overall: 'failed', identityError: 'SecretChanged' });
    expect(getConnection(db, row.id).status).toBe('failed');
  });

  it('does not change a connection that is not ready', async () => {
    const db = createTestDb();
    const row = createConnection(db, { ...base, method: 'role' }, now());
    const result = await testConnection(db, row.id, {
      secret: SECRET,
      resolver: resolver(async () => temp),
      runTest: vi.fn(),
      now,
    });
    expect(result).toMatchObject({ overall: 'failed', identityError: 'NotReady' });
    expect(getConnection(db, row.id).status).toBe('draft');
  });
});
```

- [ ] **Step 7: Run to see it fail, then implement the service and the resolver singleton**

Run: `npx vitest run tests/unit/test-connection.test.ts`
Expected: FAIL, cannot resolve `@/lib/connections/test-connection`.

Create `src/lib/connections/test-connection.ts`:

```ts
import type { AwsCredentialIdentity } from '@smithy/types';
import type { CredentialResolver } from '../aws/credentials';
import { awsErrorCode } from '../aws/errors';
import { runPermissionTest, type PermissionTestInput } from '../aws/permissions';
import { DecryptionError } from '../crypto';
import type { Db } from '../db/client';
import { ConnectionInputError, credentialsInputFor, getConnection, saveTestResult } from './repository';
import type { PermissionTestResult } from './types';

export async function testConnection(
  db: Db,
  id: string,
  deps: {
    secret: string;
    resolver: CredentialResolver;
    runTest?: (input: PermissionTestInput) => Promise<PermissionTestResult>;
    now?: () => Date;
  },
): Promise<PermissionTestResult> {
  const now = deps.now ?? (() => new Date());
  const runTest = deps.runTest ?? runPermissionTest;
  const row = getConnection(db, id);

  let credentials: AwsCredentialIdentity;
  try {
    credentials = await deps.resolver.resolve(credentialsInputFor(row, deps.secret), row.regions[0]);
  } catch (error) {
    const notReady = error instanceof ConnectionInputError;
    const identityError =
      error instanceof DecryptionError ? 'SecretChanged' : notReady ? 'NotReady' : awsErrorCode(error);
    const result: PermissionTestResult = {
      overall: 'failed',
      accountMatches: false,
      identityError,
      checks: [],
      testedAt: now().toISOString(),
    };
    if (!notReady) {
      saveTestResult(db, id, result, now());
    }
    return result;
  }

  const result = await runTest({ expectedAccountId: row.awsAccountId, regions: row.regions, credentials, now });
  saveTestResult(db, id, result, now());
  return result;
}
```

Create `src/lib/connections/resolver.ts`:

```ts
import 'server-only';
import { createCredentialResolver } from '../aws/credentials';

/** One resolver per server process so assumed-role credentials are cached across requests. */
export const credentialResolver = createCredentialResolver();
```

Run: `npx vitest run tests/unit/test-connection.test.ts`
Expected: 4 passed.

- [ ] **Step 8: Write the failing origin test, then implement it**

Create `tests/unit/origin.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isSameOrigin } from '@/lib/http/origin';

const req = (headers: Record<string, string>, url = 'http://localhost:3000/api/x') =>
  new Request(url, { method: 'POST', headers });

describe('isSameOrigin', () => {
  it('accepts a matching Origin based on the Host header', () => {
    expect(isSameOrigin(req({ origin: 'http://localhost:3000', host: 'localhost:3000' }))).toBe(true);
  });

  it('honours forwarded host and protocol', () => {
    expect(
      isSameOrigin(req({ origin: 'https://ops.example.com', 'x-forwarded-host': 'ops.example.com', 'x-forwarded-proto': 'https' })),
    ).toBe(true);
  });

  it('prefers the configured public URL', () => {
    expect(isSameOrigin(req({ origin: 'https://ops.example.com', host: 'internal:3000' }), 'https://ops.example.com/')).toBe(true);
    expect(isSameOrigin(req({ origin: 'http://internal:3000', host: 'internal:3000' }), 'https://ops.example.com')).toBe(false);
  });

  it('rejects a missing or foreign Origin', () => {
    expect(isSameOrigin(req({ host: 'localhost:3000' }))).toBe(false);
    expect(isSameOrigin(req({ origin: 'https://evil.example', host: 'localhost:3000' }))).toBe(false);
  });
});
```

Run: `npx vitest run tests/unit/origin.test.ts`
Expected: FAIL, cannot resolve `@/lib/http/origin`.

Create `src/lib/http/origin.ts`:

```ts
export function isSameOrigin(request: Request, publicUrl?: string): boolean {
  const origin = request.headers.get('origin');
  if (!origin) {
    return false;
  }
  if (publicUrl) {
    return origin === new URL(publicUrl).origin;
  }
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!host) {
    return false;
  }
  const protocol = request.headers.get('x-forwarded-proto') ?? new URL(request.url).protocol.replace(':', '');
  return origin === `${protocol}://${host}`;
}
```

Run: `npx vitest run tests/unit/origin.test.ts`
Expected: 4 passed.

- [ ] **Step 9: Commit**

Run: `npm test && npm run typecheck`

```bash
git add -A
git commit -m "feat: store connections, run connection tests, check request origin

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Design system, application shell, setup, login and accounts list

**Files:**
- Create (generated): `components.json`, `src/components/ui/*` (shadcn)
- Modify: `src/app/globals.css`, `src/app/[locale]/layout.tsx`, `messages/en.json`, `messages/fr.json`
- Create: `src/components/theme-provider.tsx`, `src/components/theme-toggle.tsx`, `src/components/locale-switcher.tsx`, `src/components/nav-items.ts`, `src/components/sidebar.tsx`, `src/components/top-bar.tsx`, `src/components/connection-switcher.tsx`, `src/components/app-shell.tsx`, `src/components/connection-status-badge.tsx`
- Create: `src/lib/auth/current.ts`, `src/lib/auth/login-limiter.ts`, `src/lib/auth/actions.ts`
- Create: `src/app/[locale]/setup/page.tsx`, `src/app/[locale]/setup/actions.ts`, `src/app/[locale]/setup/setup-form.tsx`
- Create: `src/app/[locale]/login/page.tsx`, `src/app/[locale]/login/actions.ts`, `src/app/[locale]/login/login-form.tsx`
- Create: `src/app/[locale]/(app)/layout.tsx`, `src/app/[locale]/(app)/accounts/page.tsx`

**Interfaces:**
- Consumes: `hasAdmin`, `createAdmin`, `authenticate`, `AdminValidationError`, `AdminExistsError` (Task 4); `createSession`, `validateSession`, `deleteSession`, `SESSION_TTL_MS` (Task 4); `createRateLimiter` (Task 4); `getDb` (Task 3); `env` (Task 2); `listConnections`, `toView`, `ConnectionView` (Task 9); `Link`, `redirect`, `usePathname`, `useRouter` (Task 5); `LOCALE_COOKIE`, `LOCALE_COOKIE_MAX_AGE` (Task 5).
- Produces:
  - `SESSION_COOKIE = 'opswatch_session'`
  - `getCurrentAdminId(): Promise<number | null>`, `requireAdmin(locale: string): Promise<number>`, `startSession(adminId: number): Promise<void>`, `endSession(): Promise<void>`, `clientIp(): Promise<string>`
  - `signOutAction(locale: string): Promise<void>` (server action)
  - `<AppShell signedIn connections?>` wrapping every page; `type ShellConnection = { id: string; name: string; regions: string[] }`
  - `<ConnectionStatusBadge status={ConnectionStatus} />`
  - shadcn components: `Button`, `Card*`, `Input`, `Label`, `Badge`, `Alert*`, `Tabs*`, `Separator`, `Tooltip*`, `DropdownMenu*`, `Checkbox`
  - Message namespaces `Auth`, `Shell`, `Status`, `Accounts`

- [ ] **Step 1: Initialise shadcn/ui and add the components**

```bash
npx -y shadcn@4.21.0 init --base radix --no-monorepo --yes
npx -y shadcn@4.21.0 add button card input label badge alert tabs separator tooltip dropdown-menu checkbox --yes
npm install next-themes@0.4.6
```

Expected: `components.json`, `src/components/ui/button.tsx` (and the others), updated `src/app/globals.css` with theme tokens for light and dark.

Append to the end of `src/app/globals.css` so Tailwind's `font-sans` uses Inter, and so animations and transitions stop for people who ask their system to reduce motion:

```css
@theme inline {
  --font-sans: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 2: Add the message namespaces**

Merge these top-level keys into `messages/en.json` (keep `Common`):

```json
{
  "Auth": {
    "setup": {
      "title": "Create the admin account",
      "description": "This instance has no admin yet. The account you create here is the only one that can manage AWS connections.",
      "email": "Email",
      "password": "Password",
      "passwordHint": "At least 12 characters.",
      "confirmPassword": "Confirm password",
      "submit": "Create admin account"
    },
    "login": {
      "title": "Sign in",
      "description": "Sign in to manage your AWS connections.",
      "email": "Email",
      "password": "Password",
      "submit": "Sign in"
    },
    "errors": {
      "email_invalid": "Enter a valid email address.",
      "password_too_short": "The password must be at least 12 characters long.",
      "password_mismatch": "The two passwords do not match.",
      "admin_exists": "An admin account already exists. Sign in instead.",
      "invalid_credentials": "Incorrect email or password.",
      "rate_limited": "Too many attempts. Wait a minute and try again."
    }
  },
  "Shell": {
    "openMenu": "Open menu",
    "account": "AWS account",
    "region": "Region",
    "noAccounts": "No AWS account connected",
    "manageAccounts": "Manage accounts"
  },
  "Status": {
    "draft": "Setup incomplete",
    "pending": "Not tested",
    "ok": "Connected",
    "degraded": "Partial access",
    "failed": "Failed"
  },
  "Accounts": {
    "title": "AWS accounts",
    "description": "Accounts OpsWatch can read, and what each one lets it see.",
    "add": "Add an account",
    "emptyTitle": "No AWS account connected yet",
    "emptyDescription": "Connect an account in a few minutes. Access is read-only and can be revoked at any time.",
    "emptyGuide": "Read the guide first",
    "accountId": "Account",
    "method": "Method",
    "regions": "Regions",
    "lastTested": "Last tested {date}",
    "neverTested": "Never tested",
    "methods": {
      "role": "IAM role",
      "ambient": "Running on AWS",
      "keys": "Access keys"
    }
  }
}
```

Merge these top-level keys into `messages/fr.json`:

```json
{
  "Auth": {
    "setup": {
      "title": "Créer le compte administrateur",
      "description": "Cette instance n'a pas encore d'administrateur. Le compte créé ici est le seul à pouvoir gérer les connexions AWS.",
      "email": "E-mail",
      "password": "Mot de passe",
      "passwordHint": "Au moins 12 caractères.",
      "confirmPassword": "Confirmer le mot de passe",
      "submit": "Créer le compte administrateur"
    },
    "login": {
      "title": "Connexion",
      "description": "Connectez-vous pour gérer vos connexions AWS.",
      "email": "E-mail",
      "password": "Mot de passe",
      "submit": "Se connecter"
    },
    "errors": {
      "email_invalid": "Saisissez une adresse e-mail valide.",
      "password_too_short": "Le mot de passe doit contenir au moins 12 caractères.",
      "password_mismatch": "Les deux mots de passe ne correspondent pas.",
      "admin_exists": "Un compte administrateur existe déjà. Connectez-vous.",
      "invalid_credentials": "E-mail ou mot de passe incorrect.",
      "rate_limited": "Trop de tentatives. Patientez une minute puis réessayez."
    }
  },
  "Shell": {
    "openMenu": "Ouvrir le menu",
    "account": "Compte AWS",
    "region": "Région",
    "noAccounts": "Aucun compte AWS connecté",
    "manageAccounts": "Gérer les comptes"
  },
  "Status": {
    "draft": "Configuration incomplète",
    "pending": "Non testé",
    "ok": "Connecté",
    "degraded": "Accès partiel",
    "failed": "Échec"
  },
  "Accounts": {
    "title": "Comptes AWS",
    "description": "Les comptes qu'OpsWatch peut lire, et ce que chacun lui permet de voir.",
    "add": "Ajouter un compte",
    "emptyTitle": "Aucun compte AWS connecté",
    "emptyDescription": "Connectez un compte en quelques minutes. L'accès est en lecture seule et révocable à tout moment.",
    "emptyGuide": "Lire d'abord le guide",
    "accountId": "Compte",
    "method": "Méthode",
    "regions": "Régions",
    "lastTested": "Dernier test {date}",
    "neverTested": "Jamais testé",
    "methods": {
      "role": "Rôle IAM",
      "ambient": "Exécution sur AWS",
      "keys": "Clés d'accès"
    }
  }
}
```

Run: `npx vitest run tests/unit/i18n-messages.test.ts`
Expected: 2 passed.

- [ ] **Step 3: Server-side session helpers and sign-out**

Create `src/lib/auth/current.ts`:

```ts
import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from '@/i18n/navigation';
import { getDb } from '../db/client';
import { env } from '../env';
import { hasAdmin } from './admin';
import { createSession, deleteSession, validateSession } from './sessions';

export const SESSION_COOKIE = 'opswatch_session';

// The database enforces the 12 h rolling expiry; the cookie only needs to outlive it.
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env().OPSWATCH_PUBLIC_URL?.startsWith('https://') ?? false,
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  };
}

export async function getCurrentAdminId(): Promise<number | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? validateSession(getDb(), token, env().OPSWATCH_SECRET) : null;
}

export async function requireAdmin(locale: string): Promise<number> {
  if (!hasAdmin(getDb())) {
    redirect({ href: '/setup', locale });
  }
  const adminId = await getCurrentAdminId();
  if (adminId === null) {
    redirect({ href: '/login', locale });
  }
  return adminId;
}

export async function startSession(adminId: number): Promise<void> {
  const token = createSession(getDb(), adminId, env().OPSWATCH_SECRET);
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions());
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    deleteSession(getDb(), token, env().OPSWATCH_SECRET);
  }
  store.delete(SESSION_COOKIE);
}

// Forwarding headers can be forged by any client that reaches OpsWatch directly, so this value
// is only a best-effort bucket key. The global login limiter is what bounds password guessing.
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
}
```

Create `src/lib/auth/login-limiter.ts`:

```ts
import 'server-only';
import { createRateLimiter } from './rate-limit';

// Per client: 5 attempts per minute, cleared after a successful sign-in.
export const loginLimiter = createRateLimiter({ limit: 5, windowMs: 60_000 });
// All clients together: 20 attempts per minute, cleared after a successful sign-in. The client key comes from headers a
// direct caller can forge, so this cap is what actually bounds online password guessing
// against the single admin account.
export const globalLoginLimiter = createRateLimiter({ limit: 20, windowMs: 60_000 });
export const GLOBAL_LOGIN_KEY = 'all';
```

Create `src/lib/auth/actions.ts`:

```ts
'use server';

import { redirect } from '@/i18n/navigation';
import { endSession } from './current';

export async function signOutAction(locale: string): Promise<void> {
  await endSession();
  redirect({ href: '/login', locale });
}
```

- [ ] **Step 4: Theme, language and status components**

Create `src/components/theme-provider.tsx`:

```tsx
'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
```

Create `src/components/theme-toggle.tsx`:

```tsx
'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function ThemeToggle() {
  const t = useTranslations('Common.theme');
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('label')}>
          <Sun className="size-4 dark:hidden" aria-hidden />
          <Moon className="hidden size-4 dark:block" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light">
            <Sun className="mr-2 size-4" aria-hidden /> {t('light')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon className="mr-2 size-4" aria-hidden /> {t('dark')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor className="mr-2 size-4" aria-hidden /> {t('system')}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

Create `src/components/locale-switcher.tsx`:

```tsx
'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from '@/i18n/locale-cookie';
import { routing, type AppLocale } from '@/i18n/routing';
import { cn } from '@/lib/utils';

export function LocaleSwitcher() {
  const t = useTranslations('Common.language');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  function choose(next: AppLocale) {
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
    // No localized pathnames are configured, so the current pathname (dynamic
    // segments included) is valid in every locale.
    router.replace(pathname, { locale: next });
  }

  return (
    <div role="group" aria-label={t('label')} className="flex rounded-md border p-0.5 text-xs font-medium">
      {routing.locales.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          aria-pressed={code === locale}
          title={t(code)}
          onClick={() => choose(code)}
          className={cn(
            'rounded px-2 py-1 uppercase transition-colors focus-visible:outline-2 focus-visible:outline-ring',
            code === locale ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {code}
        </button>
      ))}
    </div>
  );
}
```

Create `src/components/connection-status-badge.tsx`:

```tsx
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import type { ConnectionStatus } from '@/lib/connections/types';
import { cn } from '@/lib/utils';

const STYLES: Record<ConnectionStatus, string> = {
  draft: 'border-transparent bg-muted text-muted-foreground',
  pending: 'border-transparent bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
  ok: 'border-transparent bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  degraded: 'border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  failed: 'border-transparent bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
};

export function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  const t = useTranslations('Status');
  return <Badge className={cn(STYLES[status])}>{t(status)}</Badge>;
}
```

- [ ] **Step 5: Navigation, sidebar, top bar and shell**

Create `src/components/nav-items.ts`:

```ts
import { BookOpen, Boxes, Cloud, Database, ScrollText, type LucideIcon } from 'lucide-react';

export type NavItem = {
  key: 'gettingStarted' | 'accounts' | 'containers' | 'databases' | 'logs';
  href: string;
  icon: LucideIcon;
  enabled: boolean;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'gettingStarted', href: '/getting-started', icon: BookOpen, enabled: true },
  { key: 'accounts', href: '/accounts', icon: Cloud, enabled: true },
  { key: 'containers', href: '/containers', icon: Boxes, enabled: false },
  { key: 'databases', href: '/databases', icon: Database, enabled: false },
  { key: 'logs', href: '/logs', icon: ScrollText, enabled: false },
];
```

Create `src/components/sidebar.tsx`:

```tsx
'use client';

import { LogOut, Radar } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { signOutAction } from '@/lib/auth/actions';
import { cn } from '@/lib/utils';
import { NAV_ITEMS } from './nav-items';

export function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations('Common.nav');
  const pathname = usePathname();

  return (
    <ul className="space-y-1">
      {NAV_ITEMS.map(({ key, href, icon: Icon, enabled }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        const classes = cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm',
          active ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground',
          enabled ? 'hover:bg-accent hover:text-accent-foreground' : 'cursor-not-allowed opacity-60',
        );
        return (
          <li key={key}>
            {enabled ? (
              <Link href={href} className={classes} aria-current={active ? 'page' : undefined} onClick={onNavigate}>
                <Icon className="size-4" aria-hidden />
                {t(key)}
              </Link>
            ) : (
              <span className={classes} aria-disabled="true">
                <Icon className="size-4" aria-hidden />
                {t(key)}
                <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide">
                  {t('comingSoon')}
                </span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function Sidebar({ signedIn }: { signedIn: boolean }) {
  const t = useTranslations();
  const locale = useLocale();

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r bg-sidebar px-4 py-5 md:flex">
      <Link href="/getting-started" className="mb-8 flex items-center gap-2 px-3 text-lg font-semibold">
        <Radar className="size-5 text-primary" aria-hidden />
        {t('Common.appName')}
      </Link>
      <nav aria-label={t('Common.nav.mainNavigation')} className="flex-1">
        <NavList />
      </nav>
      {signedIn && (
        <form action={signOutAction.bind(null, locale)}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <LogOut className="size-4" aria-hidden />
            {t('Common.nav.signOut')}
          </button>
        </form>
      )}
    </aside>
  );
}
```

Create `src/components/connection-switcher.tsx`:

```tsx
'use client';

import { ChevronsUpDown, Cloud } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Link } from '@/i18n/navigation';

export type ShellConnection = { id: string; name: string; regions: string[] };

export function ConnectionSwitcher({ connections }: { connections: ShellConnection[] }) {
  const t = useTranslations('Shell');
  const params = useParams<{ id?: string }>();
  const current = connections.find((c) => c.id === params.id) ?? connections[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="max-w-64 justify-between gap-2" aria-label={t('account')}>
          <Cloud className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{current ? current.name : t('noAccounts')}</span>
          {current && <span className="text-xs text-muted-foreground">{current.regions[0]}</span>}
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{t('account')}</DropdownMenuLabel>
        {connections.map((c) => (
          <DropdownMenuItem key={c.id} asChild>
            <Link href={`/accounts/${c.id}`} className="flex flex-col items-start">
              <span>{c.name}</span>
              <span className="text-xs text-muted-foreground">
                {t('region')}: {c.regions.join(', ')}
              </span>
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/accounts">{t('manageAccounts')}</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

Create `src/components/top-bar.tsx`:

```tsx
'use client';

import { Menu, Radar } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { ConnectionSwitcher, type ShellConnection } from './connection-switcher';
import { LocaleSwitcher } from './locale-switcher';
import { NavList } from './sidebar';
import { ThemeToggle } from './theme-toggle';

export function TopBar({ connections }: { connections?: ShellConnection[] }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
      <div className="flex h-14 items-center gap-3 px-4">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label={t('Shell.openMenu')}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Menu className="size-5" aria-hidden />
        </Button>
        <Link href="/getting-started" className="flex items-center gap-2 font-semibold md:hidden">
          <Radar className="size-5 text-primary" aria-hidden />
          {t('Common.appName')}
        </Link>
        {connections && <ConnectionSwitcher connections={connections} />}
        <div className="ml-auto flex items-center gap-2">
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </div>
      {open && (
        <nav aria-label={t('Common.nav.mainNavigation')} className="border-t px-4 py-3 md:hidden">
          <NavList onNavigate={() => setOpen(false)} />
        </nav>
      )}
    </header>
  );
}
```

Create `src/components/app-shell.tsx`:

```tsx
import type { ShellConnection } from './connection-switcher';
import { Sidebar } from './sidebar';
import { TopBar } from './top-bar';

export function AppShell({
  children,
  signedIn,
  connections,
}: {
  children: React.ReactNode;
  signedIn: boolean;
  connections?: ShellConnection[];
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar signedIn={signedIn} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar connections={connections} />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:px-8">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Add the providers to the locale layout**

In `src/app/[locale]/layout.tsx`, add the imports:

```tsx
import { ThemeProvider } from '@/components/theme-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
```

and replace `<NextIntlClientProvider>{children}</NextIntlClientProvider>` with:

```tsx
<NextIntlClientProvider>
  <ThemeProvider>
    <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
  </ThemeProvider>
</NextIntlClientProvider>
```

- [ ] **Step 7: Setup page**

Create `src/app/[locale]/setup/actions.ts`:

```ts
'use server';

import { redirect } from '@/i18n/navigation';
import { AdminExistsError, AdminValidationError, createAdmin } from '@/lib/auth/admin';
import { startSession } from '@/lib/auth/current';
import { getDb } from '@/lib/db/client';

export type SetupState = {
  error?: 'email_invalid' | 'password_too_short' | 'password_mismatch' | 'admin_exists';
};

export async function setupAction(locale: string, _prev: SetupState, formData: FormData): Promise<SetupState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  if (password !== String(formData.get('confirmPassword') ?? '')) {
    return { error: 'password_mismatch' };
  }
  try {
    const adminId = await createAdmin(getDb(), { email, password });
    await startSession(adminId);
  } catch (error) {
    if (error instanceof AdminValidationError) return { error: error.code };
    if (error instanceof AdminExistsError) return { error: 'admin_exists' };
    throw error;
  }
  redirect({ href: '/accounts', locale });
}
```

Create `src/app/[locale]/setup/setup-form.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SetupState } from './actions';

export function SetupForm({ action }: { action: (prev: SetupState, data: FormData) => Promise<SetupState> }) {
  const t = useTranslations('Auth');
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{t(`errors.${state.error}`)}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="email">{t('setup.email')}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">{t('setup.password')}</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required aria-describedby="password-hint" />
        <p id="password-hint" className="text-xs text-muted-foreground">{t('setup.passwordHint')}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">{t('setup.confirmPassword')}</Label>
        <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {t('setup.submit')}
      </Button>
    </form>
  );
}
```

Create `src/app/[locale]/setup/page.tsx`:

```tsx
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { redirect } from '@/i18n/navigation';
import { hasAdmin } from '@/lib/auth/admin';
import { getDb } from '@/lib/db/client';
import { setupAction } from './actions';
import { SetupForm } from './setup-form';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string }> };

export default async function SetupPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (hasAdmin(getDb())) {
    redirect({ href: '/login', locale });
  }
  const t = await getTranslations('Auth.setup');

  return (
    <AppShell signedIn={false}>
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle><h1>{t('title')}</h1></CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <SetupForm action={setupAction.bind(null, locale)} />
        </CardContent>
      </Card>
    </AppShell>
  );
}
```

- [ ] **Step 8: Login page**

Create `src/app/[locale]/login/actions.ts`:

```ts
'use server';

import { redirect } from '@/i18n/navigation';
import { authenticate } from '@/lib/auth/admin';
import { clientIp, startSession } from '@/lib/auth/current';
import { GLOBAL_LOGIN_KEY, globalLoginLimiter, loginLimiter } from '@/lib/auth/login-limiter';
import { getDb } from '@/lib/db/client';

export type LoginState = { error?: 'invalid_credentials' | 'rate_limited' };

export async function loginAction(locale: string, _prev: LoginState, formData: FormData): Promise<LoginState> {
  const ip = await clientIp();
  if (!globalLoginLimiter.attempt(GLOBAL_LOGIN_KEY) || !loginLimiter.attempt(ip)) {
    return { error: 'rate_limited' };
  }
  const adminId = await authenticate(
    getDb(),
    String(formData.get('email') ?? ''),
    String(formData.get('password') ?? ''),
  );
  if (adminId === null) {
    return { error: 'invalid_credentials' };
  }
  loginLimiter.reset(ip);
  globalLoginLimiter.reset(GLOBAL_LOGIN_KEY);
  await startSession(adminId);
  redirect({ href: '/accounts', locale });
}
```

Create `src/app/[locale]/login/login-form.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { LoginState } from './actions';

export function LoginForm({ action }: { action: (prev: LoginState, data: FormData) => Promise<LoginState> }) {
  const t = useTranslations('Auth');
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{t(`errors.${state.error}`)}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="email">{t('login.email')}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">{t('login.password')}</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {t('login.submit')}
      </Button>
    </form>
  );
}
```

Create `src/app/[locale]/login/page.tsx`:

```tsx
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { redirect } from '@/i18n/navigation';
import { hasAdmin } from '@/lib/auth/admin';
import { getCurrentAdminId } from '@/lib/auth/current';
import { getDb } from '@/lib/db/client';
import { loginAction } from './actions';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string }> };

export default async function LoginPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!hasAdmin(getDb())) {
    redirect({ href: '/setup', locale });
  }
  if ((await getCurrentAdminId()) !== null) {
    redirect({ href: '/accounts', locale });
  }
  const t = await getTranslations('Auth.login');

  return (
    <AppShell signedIn={false}>
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle><h1>{t('title')}</h1></CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm action={loginAction.bind(null, locale)} />
        </CardContent>
      </Card>
    </AppShell>
  );
}
```

- [ ] **Step 9: Protected layout and accounts list**

Create `src/app/[locale]/(app)/layout.tsx`:

```tsx
import { setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { requireAdmin } from '@/lib/auth/current';
import { listConnections } from '@/lib/connections/repository';
import { getDb } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

type Props = { children: React.ReactNode; params: Promise<{ locale: string }> };

export default async function ProtectedLayout({ children, params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin(locale);
  const connections = listConnections(getDb()).map(({ id, name, regions }) => ({ id, name, regions }));

  return (
    <AppShell signedIn connections={connections}>
      {children}
    </AppShell>
  );
}
```

Create `src/app/[locale]/(app)/accounts/page.tsx`:

```tsx
import { Plus } from 'lucide-react';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { ConnectionStatusBadge } from '@/components/connection-status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { listConnections, toView } from '@/lib/connections/repository';
import { getDb } from '@/lib/db/client';
import { env } from '@/lib/env';

type Props = { params: Promise<{ locale: string }> };

export default async function AccountsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Accounts');
  const format = await getFormatter();
  const views = listConnections(getDb()).map((row) => toView(row, env().OPSWATCH_SECRET));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        <Button asChild>
          <Link href="/accounts/new">
            <Plus className="size-4" aria-hidden /> {t('add')}
          </Link>
        </Button>
      </div>

      {views.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader className="items-center text-center">
            <CardTitle>{t('emptyTitle')}</CardTitle>
            <CardDescription>{t('emptyDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center gap-3">
            <Button asChild>
              <Link href="/accounts/new">{t('add')}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/getting-started">{t('emptyGuide')}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {views.map((c) => (
            <li key={c.id}>
              <Link href={`/accounts/${c.id}`} className="block rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
                <Card className="h-full transition-colors hover:border-primary/40">
                  <CardHeader className="flex-row items-start justify-between gap-3">
                    <div>
                      <CardTitle>{c.name}</CardTitle>
                      <CardDescription>
                        {t('accountId')} {c.awsAccountId} · {t(`methods.${c.method}`)}
                      </CardDescription>
                    </div>
                    <ConnectionStatusBadge status={c.status} />
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    <p>{t('regions')}: {c.regions.join(', ')}</p>
                    <p>
                      {c.lastTest
                        ? t('lastTested', { date: format.relativeTime(new Date(c.lastTest.testedAt)) })
                        : t('neverTested')}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 10: Verify build and protected routing**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all succeed.

Run:

```bash
rm -rf tmp/data
OPSWATCH_SECRET=$(printf 'x%.0s' {1..40}) OPSWATCH_DATA_DIR=./tmp/data npm run start &
sleep 5
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3000/en/accounts
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3000/fr/login
curl -s http://localhost:3000/en/setup | grep -o 'Create the admin account' | head -1
kill %1
```

Expected: `307 http://localhost:3000/en/setup`, `307 http://localhost:3000/fr/setup`, `Create the admin account`. The full sign-up and sign-in flow is covered by the end-to-end tests of Task 14.

- [ ] **Step 11: Commit**

Run: `npm test`

```bash
git add -A
git commit -m "feat: add app shell, admin setup, login and accounts list

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Connection wizard, connection page, template download and test API

**Files:**
- Modify: `messages/en.json`, `messages/fr.json`
- Create: `src/components/copy-button.tsx`, `src/components/permission-checklist.tsx`
- Create: `src/app/[locale]/(app)/accounts/actions.ts`
- Create: `src/app/[locale]/(app)/accounts/new/page.tsx`, `src/app/[locale]/(app)/accounts/new/new-connection-form.tsx`
- Create: `src/app/[locale]/(app)/accounts/[id]/page.tsx`, `src/app/[locale]/(app)/accounts/[id]/forms.tsx`, `src/app/[locale]/(app)/accounts/[id]/test-button.tsx`
- Create: `src/app/api/connections/[id]/test/route.ts`, `src/app/api/connections/[id]/template/route.ts`

**Interfaces:**
- Consumes: everything from Tasks 6–10 (`detectBaseIdentity`, `trustFor`, `renderTemplateYaml`, `templateFileNameFor`, `deployCommand`, `roleArnCommand`, `quickCreateUrl`, `uploadTemplate`, `AWS_REGIONS`, repository functions, `testConnection`, `credentialResolver`, `isSameOrigin`, `requireAdmin`, `getCurrentAdminId`, `AppShell`, `ConnectionStatusBadge`).
- Produces:
  - `POST /api/connections/:id/test` → `200 PermissionTestResult` | `401 {error:'unauthorized'}` | `403 {error:'forbidden_origin'}` | `404 {error:'not_found'}`
  - `GET /api/connections/:id/template` → `200` YAML attachment `opswatch-<id>.yaml` | `401` | `404` | `400 {error:'not_a_role_connection'}` | `409 {error:'no_base_identity'}`
  - Server actions `createConnectionAction`, `saveRoleArnAction`, `saveAccessKeysAction`, `regenerateExternalIdAction`, `launchStackAction`, `deleteConnectionAction`
  - `<CopyButton value label />`, `<PermissionChecklist result account />`
  - Message namespaces `Services`, `Wizard`, `AccountDetail`, `Checklist`

- [ ] **Step 1: Add the message namespaces**

Merge into `messages/en.json`:

```json
{
  "Services": {
    "ecs": "Amazon ECS",
    "ec2": "Amazon EC2 (read)",
    "autoscaling": "Application Auto Scaling",
    "elb": "Elastic Load Balancing",
    "rds": "Amazon RDS and Aurora",
    "pi": "Performance Insights",
    "cloudwatch": "CloudWatch Metrics",
    "logs": "CloudWatch Logs"
  },
  "Wizard": {
    "title": "Add an AWS account",
    "description": "OpsWatch only reads. You can remove the connection and revoke its access at any time.",
    "methodLegend": "How should OpsWatch access this account?",
    "recommended": "Recommended",
    "methods": {
      "role": {
        "title": "IAM role",
        "description": "Deploy a read-only role with CloudFormation. OpsWatch assumes it with temporary credentials."
      },
      "ambient": {
        "title": "Running on AWS",
        "description": "Use the credentials of the environment OpsWatch runs in: ECS task role, EC2 instance profile or local profile."
      },
      "keys": {
        "title": "Access keys",
        "description": "Paste an access key for a quick local test. Not recommended in production."
      }
    },
    "name": "Connection name",
    "namePlaceholder": "Production",
    "accountId": "AWS account ID",
    "accountIdHint": "12 digits, shown in the account menu of the AWS console.",
    "regions": "Regions to read",
    "regionsHint": "Select at least one region.",
    "submit": "Create connection",
    "errors": {
      "name_invalid": "Enter a name of 1 to 80 characters.",
      "account_invalid": "The AWS account ID must be exactly 12 digits.",
      "regions_invalid": "Select at least one valid region.",
      "method_invalid": "Choose an access method.",
      "role_arn_invalid": "This is not a valid IAM role ARN.",
      "role_arn_account_mismatch": "This role belongs to another AWS account.",
      "role_arn_wrong_role": "This is not the OpsWatch role created for this connection.",
      "keys_invalid": "These access keys are not valid.",
      "wrong_method": "This action does not apply to this connection's method.",
      "not_ready": "Finish the previous steps first."
    }
  },
  "AccountDetail": {
    "back": "All accounts",
    "accountLine": "Account {account} · {regions}",
    "role": {
      "identityTitle": "OpsWatch's identity",
      "identityDetected": "OpsWatch runs as {arn}. The role will trust this identity only.",
      "identityMissing": "OpsWatch has no AWS identity yet, so it cannot generate the template. Give it one first (step 0 of the guide).",
      "guideLink": "Open the guide",
      "externalIdTitle": "ExternalId",
      "externalIdHelp": "A unique value the role requires. It prevents another OpsWatch user from pointing their instance at your role.",
      "regenerate": "Generate a new ExternalId",
      "regenerateHelp": "The deployed stack stops working until you deploy the new template.",
      "deployTitle": "Deploy the CloudFormation stack",
      "deployHelp": "Deploy the template in account {account}. It creates one read-only IAM role and nothing else.",
      "download": "Download template",
      "cliLabel": "Or deploy it with the AWS CLI:",
      "launchStack": "Launch Stack in the AWS console",
      "launchFailed": "The template could not be uploaded to the configured bucket.",
      "outdated": "A newer template is available with permissions for new features. Download it and update the stack.",
      "roleArnTitle": "Paste the role ARN",
      "roleArnHelp": "Copy RoleArn from the stack outputs, or run:",
      "roleArnLabel": "Role ARN",
      "saveRoleArn": "Save role ARN"
    },
    "keys": {
      "warning": "Access keys are meant for a quick local test. Prefer an IAM role in production.",
      "title": "Access keys",
      "accessKeyId": "Access key ID",
      "secretAccessKey": "Secret access key",
      "savedHint": "Saved key: {hint}. Enter new keys to replace it.",
      "unreadable": "The saved keys can no longer be decrypted because OPSWATCH_SECRET changed. Enter them again.",
      "save": "Save keys"
    },
    "ambient": {
      "title": "Running on AWS",
      "description": "OpsWatch uses the credentials of the environment it runs in: ECS task role, EC2 instance profile or local AWS profile. Attach the read-only policy of the guide to that identity.",
      "detected": "Detected identity: {arn}",
      "missing": "No AWS credentials were found in OpsWatch's environment."
    },
    "danger": {
      "title": "Remove this connection",
      "description": "OpsWatch forgets this account. Delete the CloudFormation stack in AWS to revoke access completely.",
      "delete": "Remove connection"
    }
  },
  "Checklist": {
    "title": "Permission test",
    "run": "Run test",
    "running": "Testing…",
    "neverRun": "Run the test to see what OpsWatch can read in this account.",
    "testedAt": "Tested {date}",
    "identity": "Connected as {arn}",
    "statuses": {
      "ok": "Allowed",
      "denied": "Missing permission",
      "error": "Could not check",
      "not_applicable": "Not applicable"
    },
    "notApplicablePi": "No database instance has Performance Insights enabled in this region.",
    "denied": "Missing {action}. {impact}",
    "error": "The check failed ({code}).",
    "impact": {
      "ecs": "The containers view will be empty.",
      "elb": "Load balancers and target health will be missing.",
      "rds": "The databases view will be empty.",
      "pi": "Top SQL and wait events will be missing.",
      "cloudwatch": "Charts will be empty.",
      "logs": "Log search will be unavailable."
    },
    "startQueryNote": "logs:StartQuery is not tested because Logs Insights queries are billed per GB scanned; it is checked on the first query.",
    "identityErrors": {
      "AccountMismatch": "These credentials belong to another AWS account than {account}.",
      "SecretChanged": "The stored access keys can no longer be decrypted: OPSWATCH_SECRET has changed. Enter the keys again.",
      "NotReady": "Finish the setup steps above before testing.",
      "AccessDenied": "OpsWatch could not assume the role. Check that the stack is deployed, the role ARN is correct and the ExternalId matches.",
      "generic": "AWS refused the credentials ({code})."
    },
    "failedRequest": "The test could not be run. Please try again."
  }
}
```

Merge into `messages/fr.json`:

```json
{
  "Services": {
    "ecs": "Amazon ECS",
    "ec2": "Amazon EC2 (lecture)",
    "autoscaling": "Application Auto Scaling",
    "elb": "Elastic Load Balancing",
    "rds": "Amazon RDS et Aurora",
    "pi": "Performance Insights",
    "cloudwatch": "CloudWatch Metrics",
    "logs": "CloudWatch Logs"
  },
  "Wizard": {
    "title": "Ajouter un compte AWS",
    "description": "OpsWatch ne fait que lire. Vous pouvez supprimer la connexion et révoquer son accès à tout moment.",
    "methodLegend": "Comment OpsWatch doit-il accéder à ce compte ?",
    "recommended": "Recommandé",
    "methods": {
      "role": {
        "title": "Rôle IAM",
        "description": "Déployez un rôle en lecture seule avec CloudFormation. OpsWatch l'assume avec des identifiants temporaires."
      },
      "ambient": {
        "title": "Exécution sur AWS",
        "description": "Utiliser les identifiants de l'environnement d'OpsWatch : rôle de tâche ECS, profil d'instance EC2 ou profil local."
      },
      "keys": {
        "title": "Clés d'accès",
        "description": "Collez une clé d'accès pour un test rapide en local. Déconseillé en production."
      }
    },
    "name": "Nom de la connexion",
    "namePlaceholder": "Production",
    "accountId": "ID du compte AWS",
    "accountIdHint": "12 chiffres, visibles dans le menu du compte de la console AWS.",
    "regions": "Régions à lire",
    "regionsHint": "Sélectionnez au moins une région.",
    "submit": "Créer la connexion",
    "errors": {
      "name_invalid": "Saisissez un nom de 1 à 80 caractères.",
      "account_invalid": "L'ID du compte AWS doit comporter exactement 12 chiffres.",
      "regions_invalid": "Sélectionnez au moins une région valide.",
      "method_invalid": "Choisissez une méthode d'accès.",
      "role_arn_invalid": "Ce n'est pas un ARN de rôle IAM valide.",
      "role_arn_account_mismatch": "Ce rôle appartient à un autre compte AWS.",
      "role_arn_wrong_role": "Ce n'est pas le rôle OpsWatch créé pour cette connexion.",
      "keys_invalid": "Ces clés d'accès ne sont pas valides.",
      "wrong_method": "Cette action ne s'applique pas à la méthode de cette connexion.",
      "not_ready": "Terminez d'abord les étapes précédentes."
    }
  },
  "AccountDetail": {
    "back": "Tous les comptes",
    "accountLine": "Compte {account} · {regions}",
    "role": {
      "identityTitle": "Identité d'OpsWatch",
      "identityDetected": "OpsWatch s'exécute en tant que {arn}. Le rôle fera confiance à cette seule identité.",
      "identityMissing": "OpsWatch n'a pas encore d'identité AWS et ne peut donc pas générer le template. Donnez-lui en une d'abord (étape 0 du guide).",
      "guideLink": "Ouvrir le guide",
      "externalIdTitle": "ExternalId",
      "externalIdHelp": "Une valeur unique exigée par le rôle. Elle empêche un autre utilisateur d'OpsWatch de pointer son instance vers votre rôle.",
      "regenerate": "Générer un nouvel ExternalId",
      "regenerateHelp": "La stack déployée ne fonctionne plus tant que le nouveau template n'est pas déployé.",
      "deployTitle": "Déployer la stack CloudFormation",
      "deployHelp": "Déployez le template dans le compte {account}. Il crée un seul rôle IAM en lecture seule, rien d'autre.",
      "download": "Télécharger le template",
      "cliLabel": "Ou déployez-le avec l'AWS CLI :",
      "launchStack": "Lancer la stack dans la console AWS",
      "launchFailed": "Le template n'a pas pu être envoyé dans le bucket configuré.",
      "outdated": "Un template plus récent est disponible, avec les permissions de nouvelles fonctionnalités. Téléchargez-le et mettez la stack à jour.",
      "roleArnTitle": "Coller l'ARN du rôle",
      "roleArnHelp": "Copiez RoleArn dans les sorties de la stack, ou exécutez :",
      "roleArnLabel": "ARN du rôle",
      "saveRoleArn": "Enregistrer l'ARN"
    },
    "keys": {
      "warning": "Les clés d'accès servent à un test rapide en local. Préférez un rôle IAM en production.",
      "title": "Clés d'accès",
      "accessKeyId": "ID de clé d'accès",
      "secretAccessKey": "Clé d'accès secrète",
      "savedHint": "Clé enregistrée : {hint}. Saisissez de nouvelles clés pour la remplacer.",
      "unreadable": "Les clés enregistrées ne peuvent plus être déchiffrées car OPSWATCH_SECRET a changé. Saisissez-les à nouveau.",
      "save": "Enregistrer les clés"
    },
    "ambient": {
      "title": "Exécution sur AWS",
      "description": "OpsWatch utilise les identifiants de son environnement : rôle de tâche ECS, profil d'instance EC2 ou profil AWS local. Attachez à cette identité la politique en lecture seule du guide.",
      "detected": "Identité détectée : {arn}",
      "missing": "Aucun identifiant AWS n'a été trouvé dans l'environnement d'OpsWatch."
    },
    "danger": {
      "title": "Supprimer cette connexion",
      "description": "OpsWatch oublie ce compte. Supprimez la stack CloudFormation dans AWS pour révoquer complètement l'accès.",
      "delete": "Supprimer la connexion"
    }
  },
  "Checklist": {
    "title": "Test des permissions",
    "run": "Lancer le test",
    "running": "Test en cours…",
    "neverRun": "Lancez le test pour voir ce qu'OpsWatch peut lire dans ce compte.",
    "testedAt": "Testé {date}",
    "identity": "Connecté en tant que {arn}",
    "statuses": {
      "ok": "Autorisé",
      "denied": "Permission manquante",
      "error": "Vérification impossible",
      "not_applicable": "Non applicable"
    },
    "notApplicablePi": "Aucune instance de base de données n'a Performance Insights activé dans cette région.",
    "denied": "{action} manquant. {impact}",
    "error": "La vérification a échoué ({code}).",
    "impact": {
      "ecs": "La vue conteneurs sera vide.",
      "elb": "Les load balancers et l'état des cibles manqueront.",
      "rds": "La vue bases de données sera vide.",
      "pi": "Le top SQL et les événements d'attente manqueront.",
      "cloudwatch": "Les graphiques seront vides.",
      "logs": "La recherche dans les logs sera indisponible."
    },
    "startQueryNote": "logs:StartQuery n'est pas testé car les requêtes Logs Insights sont facturées au Go scanné ; il est vérifié à la première requête.",
    "identityErrors": {
      "AccountMismatch": "Ces identifiants appartiennent à un autre compte AWS que {account}.",
      "SecretChanged": "Les clés d'accès enregistrées ne peuvent plus être déchiffrées : OPSWATCH_SECRET a changé. Saisissez-les à nouveau.",
      "NotReady": "Terminez les étapes de configuration ci-dessus avant de tester.",
      "AccessDenied": "OpsWatch n'a pas pu assumer le rôle. Vérifiez que la stack est déployée, que l'ARN du rôle est correct et que l'ExternalId correspond.",
      "generic": "AWS a refusé les identifiants ({code})."
    },
    "failedRequest": "Le test n'a pas pu être lancé. Réessayez."
  }
}
```

Run: `npx vitest run tests/unit/i18n-messages.test.ts`
Expected: 2 passed.

- [ ] **Step 2: API route handlers**

Create `src/app/api/connections/[id]/test/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getCurrentAdminId } from '@/lib/auth/current';
import { ConnectionNotFoundError } from '@/lib/connections/repository';
import { credentialResolver } from '@/lib/connections/resolver';
import { testConnection } from '@/lib/connections/test-connection';
import { getDb } from '@/lib/db/client';
import { env } from '@/lib/env';
import { isSameOrigin } from '@/lib/http/origin';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request, env().OPSWATCH_PUBLIC_URL)) {
    return NextResponse.json({ error: 'forbidden_origin' }, { status: 403 });
  }
  if ((await getCurrentAdminId()) === null) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  try {
    const result = await testConnection(getDb(), id, {
      secret: env().OPSWATCH_SECRET,
      resolver: credentialResolver,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ConnectionNotFoundError) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    throw error;
  }
}
```

Create `src/app/api/connections/[id]/template/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { detectBaseIdentity, trustFor } from '@/lib/aws/identity';
import { renderTemplateYaml, templateFileNameFor } from '@/lib/aws/template';
import { getCurrentAdminId } from '@/lib/auth/current';
import { ConnectionNotFoundError, getConnection } from '@/lib/connections/repository';
import { getDb } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if ((await getCurrentAdminId()) === null) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  let row;
  try {
    row = getConnection(getDb(), id);
  } catch (error) {
    if (error instanceof ConnectionNotFoundError) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    throw error;
  }
  if (row.method !== 'role' || !row.externalId) {
    return NextResponse.json({ error: 'not_a_role_connection' }, { status: 400 });
  }

  let identity;
  try {
    identity = await detectBaseIdentity(row.regions[0]);
  } catch {
    return NextResponse.json({ error: 'no_base_identity' }, { status: 409 });
  }

  const yaml = renderTemplateYaml({ connectionId: row.id, externalId: row.externalId, trust: trustFor(identity) });
  return new Response(yaml, {
    headers: {
      'content-type': 'application/x-yaml; charset=utf-8',
      'content-disposition': `attachment; filename="${templateFileNameFor(row.id)}"`,
      'cache-control': 'no-store',
    },
  });
}
```

- [ ] **Step 3: Server actions**

Create `src/app/[locale]/(app)/accounts/actions.ts`:

```ts
'use server';

import { redirect as nextRedirect } from 'next/navigation';
import { redirect } from '@/i18n/navigation';
import { detectBaseIdentity, trustFor } from '@/lib/aws/identity';
import { quickCreateUrl, renderTemplateYaml } from '@/lib/aws/template';
import { uploadTemplate } from '@/lib/aws/template-upload';
import { requireAdmin } from '@/lib/auth/current';
import {
  ConnectionInputError,
  createConnection,
  deleteConnection,
  getConnection,
  regenerateExternalId,
  setAccessKeys,
  setRoleArn,
  type ConnectionInputErrorCode,
} from '@/lib/connections/repository';
import { credentialResolver } from '@/lib/connections/resolver';
import { getDb } from '@/lib/db/client';
import { env } from '@/lib/env';

export type FormState = { error?: ConnectionInputErrorCode };

function inputError(error: unknown): FormState {
  if (error instanceof ConnectionInputError) {
    return { error: error.code };
  }
  throw error;
}

export async function createConnectionAction(locale: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin(locale);
  let id: string;
  try {
    id = createConnection(getDb(), {
      name: String(formData.get('name') ?? ''),
      method: String(formData.get('method') ?? ''),
      awsAccountId: String(formData.get('awsAccountId') ?? '').replace(/\D/g, ''),
      regions: formData.getAll('regions').map(String),
    }).id;
  } catch (error) {
    return inputError(error);
  }
  redirect({ href: `/accounts/${id}`, locale });
}

export async function saveRoleArnAction(locale: string, id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin(locale);
  try {
    setRoleArn(getDb(), id, String(formData.get('roleArn') ?? ''));
  } catch (error) {
    return inputError(error);
  }
  credentialResolver.forget(id);
  redirect({ href: `/accounts/${id}`, locale });
}

export async function saveAccessKeysAction(locale: string, id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin(locale);
  try {
    setAccessKeys(
      getDb(),
      id,
      { accessKeyId: String(formData.get('accessKeyId') ?? ''), secretAccessKey: String(formData.get('secretAccessKey') ?? '') },
      env().OPSWATCH_SECRET,
    );
  } catch (error) {
    return inputError(error);
  }
  redirect({ href: `/accounts/${id}`, locale });
}

export async function regenerateExternalIdAction(locale: string, id: string): Promise<void> {
  await requireAdmin(locale);
  regenerateExternalId(getDb(), id);
  credentialResolver.forget(id);
  redirect({ href: `/accounts/${id}`, locale });
}

export async function launchStackAction(locale: string, id: string): Promise<void> {
  await requireAdmin(locale);
  const bucket = env().OPSWATCH_TEMPLATE_BUCKET;
  const row = getConnection(getDb(), id);
  let url: string;
  try {
    if (!bucket || !row.externalId) {
      throw new Error('launch stack unavailable');
    }
    const region = row.regions[0];
    const identity = await detectBaseIdentity(region);
    const body = renderTemplateYaml({ connectionId: id, externalId: row.externalId, trust: trustFor(identity) });
    await uploadTemplate({ bucket, connectionId: id, region, body });
    url = quickCreateUrl({ bucket, connectionId: id, region });
  } catch {
    redirect({ href: { pathname: `/accounts/${id}`, query: { error: 'launch_failed' } }, locale });
  }
  nextRedirect(url);
}

export async function deleteConnectionAction(locale: string, id: string): Promise<void> {
  await requireAdmin(locale);
  deleteConnection(getDb(), id);
  credentialResolver.forget(id);
  redirect({ href: '/accounts', locale });
}
```

- [ ] **Step 4: Copy button and permission checklist**

Create `src/components/copy-button.tsx`:

```tsx
'use client';

import { Check, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const t = useTranslations('Common.actions');
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={copy} aria-label={label ?? t('copy')}>
      {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      <span aria-live="polite">{copied ? t('copied') : t('copy')}</span>
    </Button>
  );
}
```

Create `src/components/permission-checklist.tsx`:

```tsx
import { CircleCheck, CircleMinus, CircleX, TriangleAlert } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { CheckStatus, PermissionTestResult } from '@/lib/connections/types';
import { cn } from '@/lib/utils';

const ICONS: Record<CheckStatus, { icon: typeof CircleCheck; className: string }> = {
  ok: { icon: CircleCheck, className: 'text-emerald-600 dark:text-emerald-400' },
  denied: { icon: TriangleAlert, className: 'text-amber-600 dark:text-amber-400' },
  error: { icon: CircleX, className: 'text-red-600 dark:text-red-400' },
  not_applicable: { icon: CircleMinus, className: 'text-muted-foreground' },
};

const KNOWN_IDENTITY_ERRORS = ['AccountMismatch', 'SecretChanged', 'NotReady', 'AccessDenied'] as const;

export async function PermissionChecklist({ result, account }: { result: PermissionTestResult | null; account: string }) {
  const t = await getTranslations('Checklist');
  const services = await getTranslations('Services');
  const format = await getFormatter();

  if (!result) {
    return <p className="text-sm text-muted-foreground">{t('neverRun')}</p>;
  }

  if (result.identityError) {
    const code = result.identityError;
    const known = (KNOWN_IDENTITY_ERRORS as readonly string[]).includes(code);
    return (
      <div role="status" className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        {known
          ? t(`identityErrors.${code as (typeof KNOWN_IDENTITY_ERRORS)[number]}`, { account })
          : t('identityErrors.generic', { code })}
      </div>
    );
  }

  const regions = [...new Set(result.checks.map((c) => c.region))];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t('testedAt', { date: format.relativeTime(new Date(result.testedAt)) })}
        {result.identityArn && <> · {t('identity', { arn: result.identityArn })}</>}
      </p>
      {regions.map((region) => (
        <section key={region} aria-labelledby={`region-${region}`}>
          <h3 id={`region-${region}`} className="mb-2 font-mono text-xs uppercase text-muted-foreground">{region}</h3>
          <ul className="divide-y rounded-md border">
            {result.checks
              .filter((c) => c.region === region)
              .map((check) => {
                const { icon: Icon, className } = ICONS[check.status];
                return (
                  <li key={check.service} className="flex items-start gap-3 p-3">
                    <Icon className={cn('mt-0.5 size-5 shrink-0', className)} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {services(check.service)}{' '}
                        <span className="text-sm font-normal text-muted-foreground">· {t(`statuses.${check.status}`)}</span>
                      </p>
                      <p className="font-mono text-xs text-muted-foreground">{check.action}</p>
                      {check.status === 'denied' && (
                        <p className="mt-1 text-sm">{t('denied', { action: check.action, impact: t(`impact.${check.service}`) })}</p>
                      )}
                      {check.status === 'error' && <p className="mt-1 text-sm">{t('error', { code: check.errorCode ?? '' })}</p>}
                      {check.status === 'not_applicable' && check.service === 'pi' && (
                        <p className="mt-1 text-sm text-muted-foreground">{t('notApplicablePi')}</p>
                      )}
                    </div>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
      <p className="text-xs text-muted-foreground">{t('startQueryNote')}</p>
    </div>
  );
}
```

- [ ] **Step 5: New connection page**

Create `src/app/[locale]/(app)/accounts/new/new-connection-form.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CONNECTION_METHODS, type ConnectionMethod } from '@/lib/connections/types';
import { AWS_REGIONS } from '@/lib/connections/validation';
import { cn } from '@/lib/utils';
import type { FormState } from '../actions';

export function NewConnectionForm({ action }: { action: (prev: FormState, data: FormData) => Promise<FormState> }) {
  const t = useTranslations('Wizard');
  const [state, formAction, pending] = useActionState(action, {});
  const [method, setMethod] = useState<ConnectionMethod>('role');

  return (
    <form action={formAction} className="space-y-8">
      {state.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{t(`errors.${state.error}`)}</AlertDescription>
        </Alert>
      )}

      <fieldset>
        <legend className="mb-3 font-medium">{t('methodLegend')}</legend>
        <div className="grid gap-3 md:grid-cols-3">
          {CONNECTION_METHODS.map((m) => (
            <label
              key={m}
              className={cn(
                'relative cursor-pointer rounded-xl border p-4 transition-colors focus-within:outline-2 focus-within:outline-ring',
                method === m ? 'border-primary bg-primary/5' : 'hover:border-primary/40',
              )}
            >
              <input
                type="radio"
                name="method"
                value={m}
                checked={method === m}
                onChange={() => setMethod(m)}
                className="sr-only"
              />
              <span className="flex items-center gap-2 font-medium">
                {t(`methods.${m}.title`)}
                {m === 'role' && <Badge>{t('recommended')}</Badge>}
              </span>
              <span className="mt-1 block text-sm text-muted-foreground">{t(`methods.${m}.description`)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">{t('name')}</Label>
          <Input id="name" name="name" placeholder={t('namePlaceholder')} maxLength={80} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="awsAccountId">{t('accountId')}</Label>
          <Input
            id="awsAccountId"
            name="awsAccountId"
            inputMode="numeric"
            pattern="[0-9 -]{12,14}"
            placeholder="123456789012"
            required
            aria-describedby="account-hint"
          />
          <p id="account-hint" className="text-xs text-muted-foreground">{t('accountIdHint')}</p>
        </div>
      </div>

      <fieldset>
        <legend className="font-medium">{t('regions')}</legend>
        <p className="mb-3 text-xs text-muted-foreground">{t('regionsHint')}</p>
        <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto rounded-md border p-3 sm:grid-cols-3 lg:grid-cols-4">
          {AWS_REGIONS.map((region) => (
            <label key={region} className="flex items-center gap-2 font-mono text-sm">
              <Checkbox name="regions" value={region} />
              {region}
            </label>
          ))}
        </div>
      </fieldset>

      <Button type="submit" disabled={pending}>{t('submit')}</Button>
    </form>
  );
}
```

Create `src/app/[locale]/(app)/accounts/new/page.tsx`:

```tsx
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createConnectionAction } from '../actions';
import { NewConnectionForm } from './new-connection-form';

type Props = { params: Promise<{ locale: string }> };

export default async function NewConnectionPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Wizard');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </div>
      <NewConnectionForm action={createConnectionAction.bind(null, locale)} />
    </div>
  );
}
```

The shadcn `Checkbox` (Radix) renders a hidden native input carrying `name` and `value` inside a form, so `formData.getAll('regions')` receives the checked regions.

- [ ] **Step 6: Connection page forms and test button**

Create `src/app/[locale]/(app)/accounts/[id]/forms.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FormState } from '../actions';

type Action = (prev: FormState, data: FormData) => Promise<FormState>;

function ErrorAlert({ state }: { state: FormState }) {
  const t = useTranslations('Wizard.errors');
  return state.error ? (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{t(state.error)}</AlertDescription>
    </Alert>
  ) : null;
}

export function RoleArnForm({ action, defaultValue }: { action: Action; defaultValue: string }) {
  const t = useTranslations('AccountDetail.role');
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-3">
      <ErrorAlert state={state} />
      <Label htmlFor="roleArn">{t('roleArnLabel')}</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input id="roleArn" name="roleArn" defaultValue={defaultValue} className="font-mono" placeholder="arn:aws:iam::123456789012:role/OpsWatchReadOnly-…" required />
        <Button type="submit" disabled={pending}>{t('saveRoleArn')}</Button>
      </div>
    </form>
  );
}

export function AccessKeysForm({ action }: { action: Action }) {
  const t = useTranslations('AccountDetail.keys');
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-3" autoComplete="off">
      <ErrorAlert state={state} />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="accessKeyId">{t('accessKeyId')}</Label>
          <Input id="accessKeyId" name="accessKeyId" className="font-mono" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="secretAccessKey">{t('secretAccessKey')}</Label>
          <Input id="secretAccessKey" name="secretAccessKey" type="password" className="font-mono" required />
        </div>
      </div>
      <Button type="submit" disabled={pending}>{t('save')}</Button>
    </form>
  );
}
```

Create `src/app/[locale]/(app)/accounts/[id]/test-button.tsx`:

```tsx
'use client';

import { Loader2, PlayCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';

export function TestButton({ connectionId }: { connectionId: string }) {
  const t = useTranslations('Checklist');
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();

  async function run() {
    setRunning(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/connections/${connectionId}/test`, { method: 'POST' });
      if (!res.ok) {
        setFailed(true);
      }
      startTransition(() => router.refresh());
    } catch {
      setFailed(true);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Button type="button" onClick={run} disabled={running}>
        {running ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <PlayCircle className="size-4" aria-hidden />}
        {running ? t('running') : t('run')}
      </Button>
      {failed && <p role="alert" className="text-sm text-red-600">{t('failedRequest')}</p>}
    </div>
  );
}
```

- [ ] **Step 7: Connection page**

Create `src/app/[locale]/(app)/accounts/[id]/page.tsx`:

```tsx
import { ArrowLeft, Download, ExternalLink, RefreshCw, Trash2 } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ConnectionStatusBadge } from '@/components/connection-status-badge';
import { CopyButton } from '@/components/copy-button';
import { PermissionChecklist } from '@/components/permission-checklist';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { detectBaseIdentity, type CallerIdentity } from '@/lib/aws/identity';
import { deployCommand, roleArnCommand } from '@/lib/aws/template';
import { ConnectionNotFoundError, getConnection, toView } from '@/lib/connections/repository';
import { getDb } from '@/lib/db/client';
import { env } from '@/lib/env';
import {
  deleteConnectionAction,
  launchStackAction,
  regenerateExternalIdAction,
  saveAccessKeysAction,
  saveRoleArnAction,
} from '../actions';
import { AccessKeysForm, RoleArnForm } from './forms';
import { TestButton } from './test-button';

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ error?: string }>;
};

async function safeIdentity(region: string): Promise<CallerIdentity | null> {
  try {
    return await detectBaseIdentity(region);
  } catch {
    return null;
  }
}

function CodeBlock({ value }: { value: string }) {
  return (
    <div className="flex items-start gap-2">
      <pre className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{value}</pre>
      <CopyButton value={value} />
    </div>
  );
}

export default async function ConnectionPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  const { error } = await searchParams;
  setRequestLocale(locale);

  let view;
  try {
    view = toView(getConnection(getDb(), id), env().OPSWATCH_SECRET);
  } catch (e) {
    if (e instanceof ConnectionNotFoundError) notFound();
    throw e;
  }

  const t = await getTranslations('AccountDetail');
  const tAccounts = await getTranslations('Accounts');
  const tChecklist = await getTranslations('Checklist');
  const region = view.regions[0];
  const identity = view.method === 'keys' ? null : await safeIdentity(region);
  const ready = view.status !== 'draft';

  return (
    <div className="space-y-6">
      <Link href="/accounts" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> {t('back')}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{view.name}</h1>
          <p className="text-muted-foreground">
            {tAccounts(`methods.${view.method}`)} · {t('accountLine', { account: view.awsAccountId, regions: view.regions.join(', ') })}
          </p>
        </div>
        <ConnectionStatusBadge status={view.status} />
      </div>

      {view.method === 'role' && (
        <>
          <Card>
            <CardHeader>
              <CardTitle><h2>① {t('role.identityTitle')}</h2></CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {identity ? (
                <p>{t('role.identityDetected', { arn: identity.arn })}</p>
              ) : (
                <Alert variant="destructive">
                  <AlertDescription>
                    {t('role.identityMissing')}{' '}
                    <Link href="/getting-started#step-0" className="underline">{t('role.guideLink')}</Link>
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle><h2>② {t('role.deployTitle')}</h2></CardTitle>
              <CardDescription>{t('role.deployHelp', { account: view.awsAccountId })}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {view.templateOutdated && (
                <Alert><AlertDescription>{t('role.outdated')}</AlertDescription></Alert>
              )}
              {error === 'launch_failed' && (
                <Alert variant="destructive"><AlertDescription>{t('role.launchFailed')}</AlertDescription></Alert>
              )}
              <div>
                <p className="mb-1 text-sm font-medium">{t('role.externalIdTitle')}</p>
                <p className="mb-2 text-xs text-muted-foreground">{t('role.externalIdHelp')}</p>
                <CodeBlock value={view.externalId ?? ''} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild disabled={!identity}>
                  <a href={identity ? `/api/connections/${view.id}/template` : undefined} aria-disabled={!identity}>
                    <Download className="size-4" aria-hidden /> {t('role.download')}
                  </a>
                </Button>
                {env().OPSWATCH_TEMPLATE_BUCKET && identity && (
                  <form action={launchStackAction.bind(null, locale, view.id)}>
                    <Button type="submit" variant="outline">
                      <ExternalLink className="size-4" aria-hidden /> {t('role.launchStack')}
                    </Button>
                  </form>
                )}
              </div>
              <div>
                <p className="mb-2 text-sm">{t('role.cliLabel')}</p>
                <CodeBlock value={deployCommand(view.id, region)} />
              </div>
              <form action={regenerateExternalIdAction.bind(null, locale, view.id)} className="flex flex-wrap items-center gap-3">
                <Button type="submit" variant="ghost" size="sm">
                  <RefreshCw className="size-4" aria-hidden /> {t('role.regenerate')}
                </Button>
                <span className="text-xs text-muted-foreground">{t('role.regenerateHelp')}</span>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle><h2>③ {t('role.roleArnTitle')}</h2></CardTitle>
              <CardDescription>{t('role.roleArnHelp')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <CodeBlock value={roleArnCommand(view.id, region)} />
              <RoleArnForm action={saveRoleArnAction.bind(null, locale, view.id)} defaultValue={view.roleArn ?? ''} />
            </CardContent>
          </Card>
        </>
      )}

      {view.method === 'keys' && (
        <Card>
          <CardHeader>
            <CardTitle><h2>{t('keys.title')}</h2></CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert><AlertDescription>{t('keys.warning')}</AlertDescription></Alert>
            {view.accessKeyHint && <p className="text-sm">{t('keys.savedHint', { hint: view.accessKeyHint })}</p>}
            {view.keysUnreadable && (
              <Alert variant="destructive"><AlertDescription>{t('keys.unreadable')}</AlertDescription></Alert>
            )}
            <AccessKeysForm action={saveAccessKeysAction.bind(null, locale, view.id)} />
          </CardContent>
        </Card>
      )}

      {view.method === 'ambient' && (
        <Card>
          <CardHeader>
            <CardTitle><h2>{t('ambient.title')}</h2></CardTitle>
            <CardDescription>{t('ambient.description')}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {identity ? <p>{t('ambient.detected', { arn: identity.arn })}</p> : (
              <Alert variant="destructive"><AlertDescription>{t('ambient.missing')}</AlertDescription></Alert>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle><h2>{tChecklist('title')}</h2></CardTitle>
          {ready && <TestButton connectionId={view.id} />}
        </CardHeader>
        <CardContent>
          <PermissionChecklist result={view.lastTest} account={view.awsAccountId} />
        </CardContent>
      </Card>

      <Card className="border-red-200 dark:border-red-900">
        <CardHeader>
          <CardTitle><h2>{t('danger.title')}</h2></CardTitle>
          <CardDescription>{t('danger.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={deleteConnectionAction.bind(null, locale, view.id)}>
            <Button type="submit" variant="destructive">
              <Trash2 className="size-4" aria-hidden /> {t('danger.delete')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 8: Verify**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all succeed. The wizard, template download, key storage and test run are exercised end to end against moto in Task 14.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add connection wizard, template download and permission test UI

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: The "Getting started" guide

**Files:**
- Modify: `messages/en.json`, `messages/fr.json`, `src/app/[locale]/getting-started/page.tsx` (full rewrite)
- Create: `src/components/getting-started/connection-diagram.tsx`, `method-cards.tsx`, `steps.tsx`, `service-cards.tsx`, `security-section.tsx`, `troubleshooting.tsx`

**Interfaces:**
- Consumes: `SERVICE_GROUPS`, `BASE_IDENTITY_POLICY` (Task 6); `CopyButton` (Task 11); `AppShell` (Task 10); `getCurrentAdminId` (Task 10); namespace `Services` (Task 11).
- Produces: public page `/<locale>/getting-started` with section anchors `methods`, `how-it-works`, `steps`, `step-0` … `step-4`, `ambient`, `keys`, `services`, `security`, `troubleshooting`; message namespace `GettingStarted`.

- [ ] **Step 1: Add the `GettingStarted` namespace in English**

Merge into `messages/en.json`:

```json
{
  "GettingStarted": {
    "metaTitle": "Getting started",
    "title": "Connect your AWS account",
    "subtitle": "Read-only, revocable at any time, and nothing leaves your infrastructure.",
    "cta": "Connect an account",
    "methodsTitle": "Choose how OpsWatch reaches AWS",
    "methods": {
      "role": {
        "title": "IAM role",
        "badge": "Recommended",
        "description": "A read-only role created by CloudFormation. OpsWatch assumes it with temporary credentials and an ExternalId.",
        "link": "Follow the steps"
      },
      "ambient": {
        "title": "Running on AWS",
        "description": "OpsWatch runs on ECS or EC2 in the account it reads and uses its task or instance role.",
        "link": "See how"
      },
      "keys": {
        "title": "Access keys",
        "description": "Paste a key pair for a quick local test. Easy, but long-lived keys are a risk in production.",
        "link": "See how"
      }
    },
    "diagram": {
      "title": "How it works",
      "hint": "Hover over or focus a box to see what it does.",
      "nodes": {
        "account": {
          "label": "Your AWS account",
          "description": "The account OpsWatch reads. Nothing is installed in it except one IAM role."
        },
        "stack": {
          "label": "CloudFormation stack",
          "description": "Generated by OpsWatch for this connection. Deleting the stack removes the role and revokes access."
        },
        "role": {
          "label": "IAM role OpsWatchReadOnly",
          "description": "The only resource the stack creates. It has no password and no keys; it can only be assumed."
        },
        "permissions": {
          "label": "Permissions policy",
          "description": "What the role may do: describe and list ECS, ELB, RDS, Performance Insights and CloudWatch, and run Logs Insights queries. No S3, no secrets."
        },
        "trust": {
          "label": "Trust policy + ExternalId",
          "description": "Who may assume the role: only OpsWatch's identity, and only when it presents this connection's ExternalId."
        },
        "instance": {
          "label": "OpsWatch instance",
          "description": "Your self-hosted OpsWatch. It has its own AWS identity, allowed only to assume OpsWatch roles."
        },
        "assumeRole": {
          "label": "sts:AssumeRole",
          "description": "OpsWatch asks AWS STS for access, presenting the role ARN and the ExternalId. AWS checks the trust policy."
        },
        "credentials": {
          "label": "Temporary credentials (1 h)",
          "description": "STS returns credentials valid for one hour. OpsWatch renews them automatically and never stores them."
        }
      }
    },
    "stepsTitle": "Step by step",
    "role": {
      "title": "With an IAM role",
      "steps": {
        "s0": {
          "title": "Give OpsWatch an AWS identity",
          "body": "OpsWatch needs its own identity to assume roles. On a laptop, create an IAM user with only the policy below and give its keys to OpsWatch through AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY or an AWS profile. On ECS or EC2, attach the same policy to the task or instance role.",
          "policyLabel": "Policy for OpsWatch's identity"
        },
        "s1": {
          "title": "Create the connection",
          "body": "In OpsWatch, add an account and choose IAM role. OpsWatch generates a unique ExternalId and a CloudFormation template for this connection."
        },
        "s2": {
          "title": "Deploy the stack",
          "body": "In the account to read, deploy the template: upload it in the CloudFormation console, run the AWS CLI command shown on the connection page, or use Launch Stack when a template bucket is configured."
        },
        "s3": {
          "title": "Paste the role ARN",
          "body": "When the stack is complete, copy its RoleArn output and paste it on the connection page."
        },
        "s4": {
          "title": "Run the test",
          "body": "OpsWatch assumes the role and checks each service. Green means allowed, orange means a permission is missing and tells you what you lose, red means the connection failed."
        }
      }
    },
    "ambient": {
      "title": "Running on AWS",
      "steps": {
        "s1": {
          "title": "Attach the read-only permissions",
          "body": "Give the ECS task role or EC2 instance profile the actions listed in \"What each service needs\", in the account OpsWatch runs in."
        },
        "s2": {
          "title": "Create the connection",
          "body": "Add an account, choose Running on AWS, and run the test."
        }
      }
    },
    "keys": {
      "title": "With access keys",
      "steps": {
        "s1": {
          "title": "Create a dedicated IAM user",
          "body": "Create a user with only the actions listed in \"What each service needs\", then create an access key for it."
        },
        "s2": {
          "title": "Paste the keys",
          "body": "Add an account, choose Access keys and paste the key pair. OpsWatch encrypts it and never shows it again."
        },
        "s3": {
          "title": "Rotate or remove",
          "body": "Delete the key in IAM when you are done testing, or switch to an IAM role."
        }
      }
    },
    "servicesTitle": "What each service needs",
    "servicesIntro": "The role is deliberately narrower than the AWS ReadOnlyAccess policy, which can read the content of S3 buckets. OpsWatch never reads S3, Secrets Manager or SSM Parameter Store.",
    "serviceCards": {
      "actions": "IAM actions",
      "why": "Why",
      "unlocks": "Unlocks",
      "without": "Without it",
      "billed": "{action} is billed by AWS per GB of logs scanned.",
      "groups": {
        "ecs": {
          "why": "List clusters, services and tasks, and read their definitions.",
          "unlocks": "The containers view: services, tasks, deployments and events.",
          "without": "No container data at all."
        },
        "ec2": {
          "why": "Read instances, network interfaces, security groups and subnets.",
          "unlocks": "Mapping IP addresses and hosts back to services.",
          "without": "IP addresses in logs and database connections stay anonymous."
        },
        "autoscaling": {
          "why": "Read the scaling targets and policies of ECS services.",
          "unlocks": "Minimum, maximum and target values next to each service.",
          "without": "Scaling limits are not shown."
        },
        "elb": {
          "why": "Read load balancers, listeners, rules and target health.",
          "unlocks": "Which service receives which traffic, and unhealthy targets.",
          "without": "Routing and target health are missing."
        },
        "rds": {
          "why": "Read clusters, instances, proxies and events.",
          "unlocks": "The databases view, with the real writer and reader roles.",
          "without": "No database data at all."
        },
        "pi": {
          "why": "Read Performance Insights load, dimensions and SQL text.",
          "unlocks": "Top SQL, wait events and the busiest client hosts.",
          "without": "You see the CPU but not which query causes it."
        },
        "cloudwatch": {
          "why": "Read metric data, list metrics and alarms.",
          "unlocks": "Every chart: CPU, memory, requests, latency and errors.",
          "without": "Charts stay empty."
        },
        "logs": {
          "why": "List log groups and run Logs Insights queries.",
          "unlocks": "Log search and analyses such as errors per route or the busiest clients.",
          "without": "No log search."
        }
      }
    },
    "security": {
      "title": "Security",
      "canTitle": "OpsWatch can",
      "can1": "Read the metadata and metrics of the services listed above.",
      "can2": "Run the Logs Insights queries you start, which AWS bills.",
      "cannotTitle": "OpsWatch cannot",
      "cannot1": "Change, create or delete anything in your account.",
      "cannot2": "Read S3 objects, secrets or parameters.",
      "cannot3": "Be used by another OpsWatch instance, thanks to the ExternalId.",
      "externalIdTitle": "Why an ExternalId?",
      "externalIdBody": "Without it, anyone who learns your role ARN could configure their own OpsWatch to use it. This is known as the confused deputy problem. The role only accepts requests that also present the random value generated for your connection.",
      "revokeTitle": "Revoke access",
      "revokeBody": "Delete the CloudFormation stack. The role disappears and OpsWatch loses access immediately. Then remove the connection in OpsWatch."
    },
    "troubleshooting": {
      "title": "Troubleshooting",
      "items": {
        "assumeRole": {
          "title": "AccessDenied when assuming the role",
          "body": "The trust policy does not match: the stack was deployed from an older template, the ExternalId was regenerated, or OpsWatch now runs with another identity. Download the template again and update the stack."
        },
        "region": {
          "title": "A region always fails",
          "body": "The region may be disabled for your account. Enable it in the AWS account settings, or remove it from the connection."
        },
        "pi": {
          "title": "Performance Insights is \"not applicable\"",
          "body": "No instance in that region has Performance Insights enabled. Enable it on the database instance to get the top SQL."
        },
        "scp": {
          "title": "A permission stays missing although the role has it",
          "body": "A service control policy (SCP) of your AWS organization or a permissions boundary may deny the action. Ask your organization administrator."
        },
        "account": {
          "title": "The credentials belong to another account",
          "body": "The role ARN or the keys come from another AWS account than the one entered for the connection. Check the 12-digit account ID."
        }
      }
    }
  }
}
```

- [ ] **Step 2: Add the `GettingStarted` namespace in French**

Merge into `messages/fr.json`:

```json
{
  "GettingStarted": {
    "metaTitle": "Premiers pas",
    "title": "Connectez votre compte AWS",
    "subtitle": "Lecture seule, révocable à tout moment, et rien ne quitte votre infrastructure.",
    "cta": "Connecter un compte",
    "methodsTitle": "Choisissez comment OpsWatch accède à AWS",
    "methods": {
      "role": {
        "title": "Rôle IAM",
        "badge": "Recommandé",
        "description": "Un rôle en lecture seule créé par CloudFormation. OpsWatch l'assume avec des identifiants temporaires et un ExternalId.",
        "link": "Suivre les étapes"
      },
      "ambient": {
        "title": "Exécution sur AWS",
        "description": "OpsWatch tourne sur ECS ou EC2 dans le compte qu'il lit et utilise son rôle de tâche ou d'instance.",
        "link": "Voir comment"
      },
      "keys": {
        "title": "Clés d'accès",
        "description": "Collez une paire de clés pour un test rapide en local. Simple, mais des clés permanentes sont un risque en production.",
        "link": "Voir comment"
      }
    },
    "diagram": {
      "title": "Comment ça marche",
      "hint": "Survolez ou sélectionnez un bloc pour voir son rôle.",
      "nodes": {
        "account": {
          "label": "Votre compte AWS",
          "description": "Le compte qu'OpsWatch lit. Rien n'y est installé à part un rôle IAM."
        },
        "stack": {
          "label": "Stack CloudFormation",
          "description": "Générée par OpsWatch pour cette connexion. Supprimer la stack supprime le rôle et révoque l'accès."
        },
        "role": {
          "label": "Rôle IAM OpsWatchReadOnly",
          "description": "La seule ressource créée par la stack. Il n'a ni mot de passe ni clé ; il peut seulement être assumé."
        },
        "permissions": {
          "label": "Politique de permissions",
          "description": "Ce que le rôle peut faire : décrire et lister ECS, ELB, RDS, Performance Insights et CloudWatch, et lancer des requêtes Logs Insights. Ni S3, ni secrets."
        },
        "trust": {
          "label": "Trust policy + ExternalId",
          "description": "Qui peut assumer le rôle : uniquement l'identité d'OpsWatch, et seulement si elle présente l'ExternalId de cette connexion."
        },
        "instance": {
          "label": "Instance OpsWatch",
          "description": "Votre OpsWatch auto-hébergé. Il a sa propre identité AWS, autorisée uniquement à assumer les rôles OpsWatch."
        },
        "assumeRole": {
          "label": "sts:AssumeRole",
          "description": "OpsWatch demande un accès à AWS STS en présentant l'ARN du rôle et l'ExternalId. AWS vérifie la trust policy."
        },
        "credentials": {
          "label": "Identifiants temporaires (1 h)",
          "description": "STS renvoie des identifiants valables une heure. OpsWatch les renouvelle automatiquement et ne les enregistre jamais."
        }
      }
    },
    "stepsTitle": "Pas à pas",
    "role": {
      "title": "Avec un rôle IAM",
      "steps": {
        "s0": {
          "title": "Donner une identité AWS à OpsWatch",
          "body": "OpsWatch a besoin de sa propre identité pour assumer des rôles. Sur un portable, créez un utilisateur IAM avec uniquement la politique ci-dessous et donnez ses clés à OpsWatch via AWS_ACCESS_KEY_ID et AWS_SECRET_ACCESS_KEY ou un profil AWS. Sur ECS ou EC2, attachez la même politique au rôle de la tâche ou de l'instance.",
          "policyLabel": "Politique de l'identité d'OpsWatch"
        },
        "s1": {
          "title": "Créer la connexion",
          "body": "Dans OpsWatch, ajoutez un compte et choisissez Rôle IAM. OpsWatch génère un ExternalId unique et un template CloudFormation pour cette connexion."
        },
        "s2": {
          "title": "Déployer la stack",
          "body": "Dans le compte à lire, déployez le template : téléversez-le dans la console CloudFormation, lancez la commande AWS CLI affichée sur la page de la connexion, ou utilisez Launch Stack si un bucket de templates est configuré."
        },
        "s3": {
          "title": "Coller l'ARN du rôle",
          "body": "Quand la stack est terminée, copiez sa sortie RoleArn et collez-la sur la page de la connexion."
        },
        "s4": {
          "title": "Lancer le test",
          "body": "OpsWatch assume le rôle et vérifie chaque service. Vert : autorisé ; orange : une permission manque et vous voyez ce que vous perdez ; rouge : la connexion a échoué."
        }
      }
    },
    "ambient": {
      "title": "Exécution sur AWS",
      "steps": {
        "s1": {
          "title": "Attacher les permissions en lecture seule",
          "body": "Donnez au rôle de tâche ECS ou au profil d'instance EC2 les actions listées dans « Ce dont chaque service a besoin », dans le compte où tourne OpsWatch."
        },
        "s2": {
          "title": "Créer la connexion",
          "body": "Ajoutez un compte, choisissez Exécution sur AWS, puis lancez le test."
        }
      }
    },
    "keys": {
      "title": "Avec des clés d'accès",
      "steps": {
        "s1": {
          "title": "Créer un utilisateur IAM dédié",
          "body": "Créez un utilisateur avec uniquement les actions listées dans « Ce dont chaque service a besoin », puis créez-lui une clé d'accès."
        },
        "s2": {
          "title": "Coller les clés",
          "body": "Ajoutez un compte, choisissez Clés d'accès et collez la paire de clés. OpsWatch la chiffre et ne l'affiche plus jamais."
        },
        "s3": {
          "title": "Renouveler ou supprimer",
          "body": "Supprimez la clé dans IAM à la fin du test, ou passez à un rôle IAM."
        }
      }
    },
    "servicesTitle": "Ce dont chaque service a besoin",
    "servicesIntro": "Le rôle est volontairement plus restreint que la politique AWS ReadOnlyAccess, qui peut lire le contenu des buckets S3. OpsWatch ne lit jamais S3, Secrets Manager ni SSM Parameter Store.",
    "serviceCards": {
      "actions": "Actions IAM",
      "why": "Pourquoi",
      "unlocks": "Débloque",
      "without": "Sans elle",
      "billed": "{action} est facturée par AWS au Go de logs scanné.",
      "groups": {
        "ecs": {
          "why": "Lister les clusters, services et tâches, et lire leurs définitions.",
          "unlocks": "La vue conteneurs : services, tâches, déploiements et événements.",
          "without": "Aucune donnée de conteneur."
        },
        "ec2": {
          "why": "Lire les instances, interfaces réseau, groupes de sécurité et sous-réseaux.",
          "unlocks": "Retrouver le service derrière une adresse IP ou un hôte.",
          "without": "Les adresses IP des logs et des connexions aux bases restent anonymes."
        },
        "autoscaling": {
          "why": "Lire les cibles et politiques de scaling des services ECS.",
          "unlocks": "Les valeurs minimum, maximum et cible à côté de chaque service.",
          "without": "Les limites de scaling ne sont pas affichées."
        },
        "elb": {
          "why": "Lire les load balancers, listeners, règles et l'état des cibles.",
          "unlocks": "Quel service reçoit quel trafic, et les cibles en mauvaise santé.",
          "without": "Le routage et l'état des cibles manquent."
        },
        "rds": {
          "why": "Lire les clusters, instances, proxies et événements.",
          "unlocks": "La vue bases de données, avec les vrais rôles writer et reader.",
          "without": "Aucune donnée de base de données."
        },
        "pi": {
          "why": "Lire la charge, les dimensions et le texte SQL de Performance Insights.",
          "unlocks": "Le top SQL, les événements d'attente et les clients les plus actifs.",
          "without": "Vous voyez le CPU mais pas la requête qui le consomme."
        },
        "cloudwatch": {
          "why": "Lire les données de métriques, lister les métriques et les alarmes.",
          "unlocks": "Tous les graphiques : CPU, mémoire, requêtes, latence et erreurs.",
          "without": "Les graphiques restent vides."
        },
        "logs": {
          "why": "Lister les groupes de logs et lancer des requêtes Logs Insights.",
          "unlocks": "La recherche dans les logs et des analyses comme les erreurs par route ou les clients les plus actifs.",
          "without": "Pas de recherche dans les logs."
        }
      }
    },
    "security": {
      "title": "Sécurité",
      "canTitle": "OpsWatch peut",
      "can1": "Lire les métadonnées et métriques des services listés ci-dessus.",
      "can2": "Lancer les requêtes Logs Insights que vous démarrez, facturées par AWS.",
      "cannotTitle": "OpsWatch ne peut pas",
      "cannot1": "Modifier, créer ou supprimer quoi que ce soit dans votre compte.",
      "cannot2": "Lire des objets S3, des secrets ou des paramètres.",
      "cannot3": "Être utilisé par une autre instance d'OpsWatch, grâce à l'ExternalId.",
      "externalIdTitle": "Pourquoi un ExternalId ?",
      "externalIdBody": "Sans lui, quiconque connaît l'ARN de votre rôle pourrait configurer son propre OpsWatch pour l'utiliser. C'est le problème dit du « confused deputy ». Le rôle n'accepte que les demandes qui présentent aussi la valeur aléatoire générée pour votre connexion.",
      "revokeTitle": "Révoquer l'accès",
      "revokeBody": "Supprimez la stack CloudFormation. Le rôle disparaît et OpsWatch perd l'accès immédiatement. Supprimez ensuite la connexion dans OpsWatch."
    },
    "troubleshooting": {
      "title": "Dépannage",
      "items": {
        "assumeRole": {
          "title": "AccessDenied en assumant le rôle",
          "body": "La trust policy ne correspond pas : la stack vient d'un ancien template, l'ExternalId a été régénéré, ou OpsWatch tourne désormais avec une autre identité. Téléchargez à nouveau le template et mettez la stack à jour."
        },
        "region": {
          "title": "Une région échoue toujours",
          "body": "La région est peut-être désactivée pour votre compte. Activez-la dans les paramètres du compte AWS, ou retirez-la de la connexion."
        },
        "pi": {
          "title": "Performance Insights est « non applicable »",
          "body": "Aucune instance de cette région n'a Performance Insights activé. Activez-le sur l'instance de base de données pour obtenir le top SQL."
        },
        "scp": {
          "title": "Une permission reste manquante alors que le rôle l'a",
          "body": "Une service control policy (SCP) de votre organisation AWS ou une permissions boundary refuse peut-être l'action. Demandez à l'administrateur de l'organisation."
        },
        "account": {
          "title": "Les identifiants appartiennent à un autre compte",
          "body": "L'ARN du rôle ou les clés proviennent d'un autre compte AWS que celui saisi pour la connexion. Vérifiez l'ID de compte à 12 chiffres."
        }
      }
    }
  }
}
```

Run: `npx vitest run tests/unit/i18n-messages.test.ts`
Expected: 2 passed.

- [ ] **Step 3: Interactive diagram**

Create `src/components/getting-started/connection-diagram.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const NODES = [
  { id: 'account', x: 20, y: 20, w: 460, h: 370, container: true },
  { id: 'stack', x: 40, y: 62, w: 420, h: 310, container: true },
  { id: 'role', x: 60, y: 104, w: 380, h: 56, container: false },
  { id: 'permissions', x: 60, y: 196, w: 180, h: 70, container: false },
  { id: 'trust', x: 260, y: 196, w: 180, h: 70, container: false },
  { id: 'instance', x: 540, y: 104, w: 200, h: 56, container: false },
  { id: 'assumeRole', x: 540, y: 210, w: 200, h: 56, container: false },
  { id: 'credentials', x: 540, y: 316, w: 200, h: 56, container: false },
] as const;

type NodeId = (typeof NODES)[number]['id'];

export function ConnectionDiagram() {
  const t = useTranslations('GettingStarted.diagram');
  const [active, setActive] = useState<NodeId>('role');

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('hint')}</p>
      <svg viewBox="0 0 760 400" className="h-auto w-full" role="group" aria-label={t('title')}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="fill-muted-foreground" />
          </marker>
        </defs>

        <line x1="640" y1="160" x2="640" y2="208" className="stroke-muted-foreground" strokeWidth="1.5" markerEnd="url(#arrow)" />
        <line x1="540" y1="238" x2="442" y2="231" className="stroke-primary" strokeWidth="1.5" strokeDasharray="5 4" markerEnd="url(#arrow)" />
        <line x1="640" y1="266" x2="640" y2="314" className="stroke-muted-foreground" strokeWidth="1.5" markerEnd="url(#arrow)" />
        <line x1="150" y1="196" x2="150" y2="162" className="stroke-muted-foreground" strokeWidth="1.5" markerEnd="url(#arrow)" />
        <line x1="350" y1="196" x2="350" y2="162" className="stroke-muted-foreground" strokeWidth="1.5" markerEnd="url(#arrow)" />

        {NODES.map((node) => {
          const isActive = active === node.id;
          return (
            <g
              key={node.id}
              role="button"
              tabIndex={0}
              aria-pressed={isActive}
              aria-label={t(`nodes.${node.id}.label`)}
              onMouseEnter={() => setActive(node.id)}
              onFocus={() => setActive(node.id)}
              onClick={() => setActive(node.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setActive(node.id);
                }
              }}
              className="cursor-pointer outline-none"
            >
              <rect
                x={node.x}
                y={node.y}
                width={node.w}
                height={node.h}
                rx={node.container ? 14 : 10}
                className={cn(
                  'transition-colors',
                  node.container ? 'fill-muted/40' : 'fill-card',
                  isActive ? 'stroke-primary' : 'stroke-border',
                  node.id === 'instance' && 'fill-primary/10',
                )}
                strokeWidth={isActive ? 2.5 : 1.5}
                strokeDasharray={node.container ? '6 4' : undefined}
              />
              <text
                x={node.container ? node.x + 16 : node.x + node.w / 2}
                y={node.container ? node.y + 26 : node.y + node.h / 2 + 4}
                textAnchor={node.container ? 'start' : 'middle'}
                className={cn('fill-foreground text-[12px]', isActive && 'font-semibold')}
              >
                {t(`nodes.${node.id}.label`)}
              </text>
            </g>
          );
        })}
      </svg>
      <div aria-live="polite" className="rounded-lg border bg-card p-4">
        <p className="font-medium">{t(`nodes.${active}.label`)}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t(`nodes.${active}.description`)}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Method cards, steps, service cards, security and troubleshooting**

Create `src/components/getting-started/method-cards.tsx`:

```tsx
import { ArrowRight, KeyRound, Server, ShieldCheck } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const METHODS = [
  { key: 'role', icon: ShieldCheck, anchor: '#steps', recommended: true },
  { key: 'ambient', icon: Server, anchor: '#ambient', recommended: false },
  { key: 'keys', icon: KeyRound, anchor: '#keys', recommended: false },
] as const;

export async function MethodCards() {
  const t = await getTranslations('GettingStarted.methods');

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {METHODS.map(({ key, icon: Icon, anchor, recommended }) => (
        <Card key={key} className={recommended ? 'border-primary/50 shadow-sm' : undefined}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <Icon className="size-6 text-primary" aria-hidden />
              {recommended && <Badge>{t('role.badge')}</Badge>}
            </div>
            <CardTitle className="pt-2">{t(`${key}.title`)}</CardTitle>
            <CardDescription>{t(`${key}.description`)}</CardDescription>
          </CardHeader>
          <CardContent>
            <a href={anchor} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              {t(`${key}.link`)} <ArrowRight className="size-4" aria-hidden />
            </a>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

Create `src/components/getting-started/steps.tsx`:

```tsx
import { getTranslations } from 'next-intl/server';
import { CopyButton } from '@/components/copy-button';
import { BASE_IDENTITY_POLICY } from '@/lib/aws/actions';

function StepList({ items, idPrefix, startAt }: { items: { title: string; body: string; extra?: React.ReactNode }[]; idPrefix?: string; startAt: number }) {
  return (
    <ol className="space-y-6">
      {items.map((item, index) => {
        const number = startAt + index;
        return (
          <li key={item.title} id={idPrefix ? `${idPrefix}-${number}` : undefined} className="flex gap-4 scroll-mt-20">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground" aria-hidden>
              {number}
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <h4 className="font-medium">{item.title}</h4>
              <p className="text-sm text-muted-foreground">{item.body}</p>
              {item.extra}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export async function Steps() {
  const t = await getTranslations('GettingStarted');
  const policy = JSON.stringify(BASE_IDENTITY_POLICY, null, 2);

  return (
    <div className="space-y-12">
      <div>
        <h3 className="mb-6 text-lg font-semibold">{t('role.title')}</h3>
        <StepList
          idPrefix="step"
          startAt={0}
          items={[
            {
              title: t('role.steps.s0.title'),
              body: t('role.steps.s0.body'),
              extra: (
                <div className="space-y-2">
                  <p className="text-xs font-medium">{t('role.steps.s0.policyLabel')}</p>
                  <div className="flex items-start gap-2">
                    <pre className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{policy}</pre>
                    <CopyButton value={policy} />
                  </div>
                </div>
              ),
            },
            { title: t('role.steps.s1.title'), body: t('role.steps.s1.body') },
            { title: t('role.steps.s2.title'), body: t('role.steps.s2.body') },
            { title: t('role.steps.s3.title'), body: t('role.steps.s3.body') },
            { title: t('role.steps.s4.title'), body: t('role.steps.s4.body') },
          ]}
        />
      </div>

      <div id="ambient" className="scroll-mt-20">
        <h3 className="mb-6 text-lg font-semibold">{t('ambient.title')}</h3>
        <StepList
          startAt={1}
          items={[
            { title: t('ambient.steps.s1.title'), body: t('ambient.steps.s1.body') },
            { title: t('ambient.steps.s2.title'), body: t('ambient.steps.s2.body') },
          ]}
        />
      </div>

      <div id="keys" className="scroll-mt-20">
        <h3 className="mb-6 text-lg font-semibold">{t('keys.title')}</h3>
        <StepList
          startAt={1}
          items={[
            { title: t('keys.steps.s1.title'), body: t('keys.steps.s1.body') },
            { title: t('keys.steps.s2.title'), body: t('keys.steps.s2.body') },
            { title: t('keys.steps.s3.title'), body: t('keys.steps.s3.body') },
          ]}
        />
      </div>
    </div>
  );
}
```

Create `src/components/getting-started/service-cards.tsx`:

```tsx
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SERVICE_GROUPS } from '@/lib/aws/actions';

export async function ServiceCards() {
  const t = await getTranslations('GettingStarted.serviceCards');
  const services = await getTranslations('Services');

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {SERVICE_GROUPS.map((group) => (
        <Card key={group.id}>
          <CardHeader>
            <CardTitle>{services(group.id)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <dl className="space-y-2">
              <div>
                <dt className="font-medium">{t('why')}</dt>
                <dd className="text-muted-foreground">{t(`groups.${group.id}.why`)}</dd>
              </div>
              <div>
                <dt className="font-medium">{t('unlocks')}</dt>
                <dd className="text-muted-foreground">{t(`groups.${group.id}.unlocks`)}</dd>
              </div>
              <div>
                <dt className="font-medium">{t('without')}</dt>
                <dd className="text-muted-foreground">{t(`groups.${group.id}.without`)}</dd>
              </div>
            </dl>
            <div>
              <p className="mb-1 font-medium">{t('actions')}</p>
              <ul className="flex flex-wrap gap-1.5">
                {group.actions.map((action) => (
                  <li key={action}>
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{action}</code>
                  </li>
                ))}
              </ul>
            </div>
            {group.billedActions.map((action) => (
              <p key={action} className="rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                {t('billed', { action })}
              </p>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

Create `src/components/getting-started/security-section.tsx`:

```tsx
import { CircleCheck, CircleX } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export async function SecuritySection() {
  const t = await getTranslations('GettingStarted.security');

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>{t('canTitle')}</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {(['can1', 'can2'] as const).map((key) => (
              <li key={key} className="flex gap-2">
                <CircleCheck className="size-4 shrink-0 text-emerald-600" aria-hidden /> {t(key)}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t('cannotTitle')}</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {(['cannot1', 'cannot2', 'cannot3'] as const).map((key) => (
              <li key={key} className="flex gap-2">
                <CircleX className="size-4 shrink-0 text-red-600" aria-hidden /> {t(key)}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t('externalIdTitle')}</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">{t('externalIdBody')}</CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t('revokeTitle')}</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">{t('revokeBody')}</CardContent>
      </Card>
    </div>
  );
}
```

Create `src/components/getting-started/troubleshooting.tsx`:

```tsx
import { ChevronDown } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

const ITEMS = ['assumeRole', 'region', 'pi', 'scp', 'account'] as const;

export async function Troubleshooting() {
  const t = await getTranslations('GettingStarted.troubleshooting.items');

  return (
    <div className="divide-y rounded-lg border">
      {ITEMS.map((key) => (
        <details key={key} className="group p-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium">
            {t(`${key}.title`)}
            <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <p className="mt-2 text-sm text-muted-foreground">{t(`${key}.body`)}</p>
        </details>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Assemble the page**

Replace `src/app/[locale]/getting-started/page.tsx` with:

```tsx
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { ConnectionDiagram } from '@/components/getting-started/connection-diagram';
import { MethodCards } from '@/components/getting-started/method-cards';
import { SecuritySection } from '@/components/getting-started/security-section';
import { ServiceCards } from '@/components/getting-started/service-cards';
import { Steps } from '@/components/getting-started/steps';
import { Troubleshooting } from '@/components/getting-started/troubleshooting';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { getCurrentAdminId } from '@/lib/auth/current';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'GettingStarted' });
  return { title: t('metaTitle') };
}

function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 space-y-6">
      <div>
        <h2 id={`${id}-title`} className="text-2xl font-semibold tracking-tight">{title}</h2>
        {intro && <p className="mt-2 max-w-3xl text-muted-foreground">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

export default async function GettingStartedPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('GettingStarted');
  const signedIn = (await getCurrentAdminId()) !== null;

  return (
    <AppShell signedIn={signedIn}>
      <div className="space-y-16">
        <header className="rounded-2xl border bg-gradient-to-br from-primary/10 via-background to-background px-6 py-10 md:px-10">
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{t('title')}</h1>
          <p className="mt-3 max-w-2xl text-lg text-muted-foreground">{t('subtitle')}</p>
          <Button asChild size="lg" className="mt-6">
            <Link href="/accounts/new">{t('cta')}</Link>
          </Button>
        </header>

        <Section id="methods" title={t('methodsTitle')}>
          <MethodCards />
        </Section>

        <Section id="how-it-works" title={t('diagram.title')}>
          <ConnectionDiagram />
        </Section>

        <Section id="steps" title={t('stepsTitle')}>
          <Steps />
        </Section>

        <Section id="services" title={t('servicesTitle')} intro={t('servicesIntro')}>
          <ServiceCards />
        </Section>

        <Section id="security" title={t('security.title')}>
          <SecuritySection />
        </Section>

        <Section id="troubleshooting" title={t('troubleshooting.title')}>
          <Troubleshooting />
        </Section>
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 6: Verify both languages render**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all succeed.

Run:

```bash
OPSWATCH_SECRET=$(printf 'x%.0s' {1..40}) OPSWATCH_DATA_DIR=./tmp/data npm run start &
sleep 5
curl -s http://localhost:3000/en/getting-started | grep -o 'Connect your AWS account' | head -1
curl -s http://localhost:3000/fr/getting-started | grep -o 'Connectez votre compte AWS' | head -1
curl -s http://localhost:3000/en/getting-started | grep -o 'arn:aws:iam::\*:role/OpsWatchReadOnly-\*' | head -1
kill %1
```

Expected: the three strings are printed.

- [ ] **Step 7: Commit**

Run: `npm test`

```bash
git add -A
git commit -m "feat: add the bilingual getting started guide with interactive diagram

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Docker image and Compose files

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `docker-compose.test.yml`, `.env.example`

**Interfaces:**
- Consumes: the whole application (Tasks 1–12); `drizzle/` migrations (Task 3).
- Produces: image serving on port 3000 as user `opswatch` (uid/gid 1001) with data in `/data`; `docker-compose.test.yml` exposing OpsWatch on `http://localhost:3100` wired to moto 5.2.3 (`http://moto:5000`), used by Task 14 and CI.

- [ ] **Step 1: Write the Dockerfile**

Create `Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    OPSWATCH_DATA_DIR=/data

RUN groupadd --system --gid 1001 opswatch \
  && useradd --system --uid 1001 --gid opswatch --create-home --home-dir /home/opswatch opswatch \
  && mkdir -p /data && chown opswatch:opswatch /data

COPY --from=build --chown=opswatch:opswatch /app/.next/standalone ./
COPY --from=build --chown=opswatch:opswatch /app/.next/static ./.next/static
COPY --from=build --chown=opswatch:opswatch /app/public ./public
COPY --from=build --chown=opswatch:opswatch /app/drizzle ./drizzle
# Native modules: copied whole so their prebuilt binaries are present whatever the tracer kept.
# better-sqlite3 13 loads its own prebuilds and has no runtime dependency (node-addon-api is build-time only).
COPY --from=deps --chown=opswatch:opswatch /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=deps --chown=opswatch:opswatch /app/node_modules/@node-rs ./node_modules/@node-rs

USER opswatch
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/en/getting-started').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
```

Create `.dockerignore`:

```
.git
.next
node_modules
tmp
data
test-results
playwright-report
.env
*.sqlite
docs
```

- [ ] **Step 2: Compose files and example environment**

Create `.env.example`:

```bash
# Required: at least 32 random characters. Generate one with: openssl rand -base64 48
OPSWATCH_SECRET=

# Where the SQLite database lives inside the container.
OPSWATCH_DATA_DIR=/data

# Public URL of this instance. Enables Secure cookies (https) and is used for origin checks behind a proxy.
# OPSWATCH_PUBLIC_URL=https://opswatch.example.com

# Optional S3 bucket enabling the "Launch Stack" button.
# OpsWatch's own identity then also needs s3:PutObject on this bucket.
# OPSWATCH_TEMPLATE_BUCKET=

# OpsWatch's own AWS identity (see step 0 of the getting started guide).
# Leave empty when OpsWatch runs on ECS or EC2 with a task or instance role.
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
# AWS_PROFILE=
# AWS_REGION=eu-west-1

# Tests only: routes every AWS SDK client to this endpoint (a moto server). Never set it in production.
# OPSWATCH_AWS_ENDPOINT_URL=http://localhost:5055
```

Create `docker-compose.yml`:

```yaml
services:
  opswatch:
    build: .
    image: opswatch:local
    restart: unless-stopped
    ports:
      - "3000:3000"
    env_file: .env
    volumes:
      - opswatch-data:/data
      # Optional: use a local AWS profile as OpsWatch's identity (set AWS_PROFILE in .env).
      # - ${HOME}/.aws:/home/opswatch/.aws:ro

volumes:
  opswatch-data:
```

Create `docker-compose.test.yml`:

```yaml
name: opswatch-test

services:
  moto:
    image: motoserver/moto:5.2.3
    ports:
      - "5055:5000"

  opswatch:
    build: .
    image: opswatch:test
    depends_on:
      - moto
    ports:
      - "3100:3000"
    environment:
      OPSWATCH_SECRET: test-secret-0123456789abcdef0123456789abcdef
      OPSWATCH_DATA_DIR: /data
      OPSWATCH_AWS_ENDPOINT_URL: http://moto:5000
      AWS_ACCESS_KEY_ID: testing
      AWS_SECRET_ACCESS_KEY: testing
      AWS_REGION: us-east-1
    tmpfs:
      - /data:uid=1001,gid=1001
```

- [ ] **Step 3: Verify the image refuses to start without a secret**

Run:

```bash
docker compose -f docker-compose.test.yml build opswatch
docker run --rm opswatch:test; echo "exit code: $?"
```

Expected: a log line `[opswatch] Invalid OpsWatch configuration: OPSWATCH_SECRET: ...` and `exit code: 1`.

- [ ] **Step 4: Verify the test stack serves pages and reaches moto**

Run:

```bash
docker compose -f docker-compose.test.yml up -d --wait
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3100/en/getting-started
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3100/en/accounts
docker compose -f docker-compose.test.yml exec opswatch node -e "fetch('http://moto:5000/moto-api/').then(r=>console.log('moto', r.status))"
docker compose -f docker-compose.test.yml down -v
```

Expected: `200`, `307 http://localhost:3100/en/setup`, `moto 200`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "build: add Docker image and Compose files for local use and tests

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: End-to-end tests against moto

**Files:**
- Create: `tests/e2e/playwright.config.ts`, `tests/e2e/helpers.ts`, `tests/e2e/01-setup.spec.ts`, `tests/e2e/02-getting-started.spec.ts`, `tests/e2e/03-connections.spec.ts`

**Interfaces:**
- Consumes: the test stack of Task 13 (`http://localhost:3100`, fresh `/data` per `up`); visible texts from `messages/en.json` and `messages/fr.json`.
- Produces: `npm run e2e` (files run in name order on one worker, because `01-setup` creates the admin the others use).

- [ ] **Step 1: Configuration and helpers**

Create `tests/e2e/playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../../playwright-report' }]],
  outputDir: '../../test-results',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3100',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
```

Create `tests/e2e/helpers.ts`:

```ts
import { expect, type Page } from '@playwright/test';

export const ADMIN = { email: 'admin@example.com', password: 'correct horse battery staple' };
export const MOTO_ACCOUNT = '123456789012';

export async function login(page: Page) {
  await page.goto('/en/login');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/en\/accounts$/);
}
```

- [ ] **Step 2: Setup and login tests**

Create `tests/e2e/01-setup.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { ADMIN, login } from './helpers';

test('protected pages redirect to setup before an admin exists', async ({ page }) => {
  await page.goto('/en/accounts');
  await expect(page).toHaveURL(/\/en\/setup$/);
});

test('the getting started guide is public', async ({ page }) => {
  await page.goto('/en/getting-started');
  await expect(page.getByRole('heading', { level: 1, name: 'Connect your AWS account' })).toBeVisible();
});

test('rejects mismatched passwords, then creates the admin', async ({ page }) => {
  await page.goto('/en/setup');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByLabel('Confirm password').fill('something else entirely');
  await page.getByRole('button', { name: 'Create admin account' }).click();
  await expect(page.getByRole('alert')).toHaveText('The two passwords do not match.');

  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByLabel('Confirm password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Create admin account' }).click();
  await expect(page).toHaveURL(/\/en\/accounts$/);
  await expect(page.getByRole('heading', { level: 1, name: 'AWS accounts' })).toBeVisible();
});

test('setup is closed once an admin exists', async ({ page }) => {
  await page.goto('/en/setup');
  await expect(page).toHaveURL(/\/en\/login$/);
});

test('wrong password is refused, right password signs in, sign out works', async ({ page }) => {
  await page.goto('/en/login');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill('not the right password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Incorrect email or password.');

  await login(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/en\/login$/);
  await page.goto('/en/accounts');
  await expect(page).toHaveURL(/\/en\/login$/);
});
```

- [ ] **Step 3: Language and guide tests**

Create `tests/e2e/02-getting-started.spec.ts`:

```ts
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
```

- [ ] **Step 4: Connection tests**

Create `tests/e2e/03-connections.spec.ts`:

```ts
import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { MOTO_ACCOUNT, login } from './helpers';

test.beforeEach(async ({ page }) => {
  await login(page);
});

async function createConnection(page: Page, method: 'role' | 'keys', name: string) {
  await page.goto('/en/accounts/new');
  // The radio inputs are visually hidden inside their card labels.
  await page.locator(`input[name="method"][value="${method}"]`).check({ force: true });
  await page.getByLabel('Connection name').fill(name);
  await page.getByLabel('AWS account ID').fill(MOTO_ACCOUNT);
  await page.getByRole('checkbox', { name: 'us-east-1' }).click();
  await page.getByRole('button', { name: 'Create connection' }).click();
  await expect(page).toHaveURL(/\/en\/accounts\/[0-9a-f]{12}$/);
  return page.url().split('/').pop() as string;
}

test('role connection: template download, role ARN and a passing test', async ({ page }) => {
  const id = await createConnection(page, 'role', 'Moto role');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download template' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`opswatch-${id}.yaml`);
  const template = fs.readFileSync((await download.path()) as string, 'utf8');
  expect(template).toContain('sts:ExternalId');
  expect(template).toContain(`OpsWatchReadOnly-${id}`);

  await page.getByLabel('Role ARN').fill(`arn:aws:iam::${MOTO_ACCOUNT}:role/OpsWatchReadOnly-${id}`);
  await page.getByRole('button', { name: 'Save role ARN' }).click();
  await expect(page.getByText('Not tested', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Run test' }).click();
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('listitem').filter({ hasText: 'Amazon ECS' })).toContainText('Allowed');
});

test('refuses a role ARN from another account', async ({ page }) => {
  const id = await createConnection(page, 'role', 'Wrong account');
  await page.getByLabel('Role ARN').fill(`arn:aws:iam::999999999999:role/OpsWatchReadOnly-${id}`);
  await page.getByRole('button', { name: 'Save role ARN' }).click();
  await expect(page.getByRole('alert')).toHaveText('This role belongs to another AWS account.');
});

test('access keys are masked after saving and can be tested', async ({ page }) => {
  const secret = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
  await createConnection(page, 'keys', 'Moto keys');
  await page.getByLabel('Access key ID').fill('AKIAIOSFODNN7EXAMPLE');
  await page.getByLabel('Secret access key').fill(secret);
  await page.getByRole('button', { name: 'Save keys' }).click();

  await expect(page.getByText('Saved key: AKIA…MPLE. Enter new keys to replace it.')).toBeVisible();
  expect(await page.content()).not.toContain(secret);

  await page.getByRole('button', { name: 'Run test' }).click();
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 30_000 });
});

test('the test API rejects foreign origins and missing sessions', async ({ playwright, baseURL }) => {
  const anonymous = await playwright.request.newContext({ baseURL });
  const foreign = await anonymous.post('/api/connections/abc123def456/test', { headers: { origin: 'https://evil.example' } });
  expect(foreign.status()).toBe(403);
  const noSession = await anonymous.post('/api/connections/abc123def456/test', { headers: { origin: baseURL as string } });
  expect(noSession.status()).toBe(401);
  await anonymous.dispose();
});
```

- [ ] **Step 5: Run the suite against a fresh stack**

```bash
npx playwright install chromium
docker compose -f docker-compose.test.yml up -d --build --wait
npm run e2e
docker compose -f docker-compose.test.yml down -v
```

Expected: 13 passed. A failure in `03-connections` usually means moto was not reachable from the container: check `docker compose -f docker-compose.test.yml logs opswatch` for `assume_role` events.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test: add end-to-end tests against moto

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Continuous integration

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: npm scripts `lint`, `typecheck`, `test`, `lint:template`, `e2e` (Task 1); `docker-compose.test.yml` (Task 13); Playwright suite (Task 14).
- Produces: three jobs, `checks`, `e2e` and `docker`, run on every push to `main` and every pull request.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  checks:
    name: Lint, typecheck, unit tests, template lint
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v7.0.1
      - uses: actions/setup-node@v7.0.0
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run lint:template

  e2e:
    name: End-to-end tests (moto)
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v7.0.1
      - uses: actions/setup-node@v7.0.0
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - name: Start OpsWatch and moto
        run: docker compose -f docker-compose.test.yml up -d --build --wait
      - run: npx playwright install --with-deps chromium
      - run: npm run e2e
        env:
          E2E_BASE_URL: http://localhost:3100
      - name: Container logs
        if: failure()
        run: docker compose -f docker-compose.test.yml logs
      - uses: actions/upload-artifact@v7.0.1
        if: failure()
        with:
          name: playwright-report
          path: |
            playwright-report
            test-results
          retention-days: 7
      - name: Stop the stack
        if: always()
        run: docker compose -f docker-compose.test.yml down -v

  docker:
    name: Docker image build
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v7.0.1
      - run: docker build -t opswatch:ci .
      - name: Refuses to start without a secret
        run: |
          set +e
          docker run --rm opswatch:ci
          code=$?
          set -e
          test "$code" -eq 1
```

- [ ] **Step 2: Validate the workflow locally**

Run:

```bash
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12 -color
```

Expected: no output and exit code 0.

- [ ] **Step 3: Run each job's commands locally once**

```bash
npm run lint && npm run typecheck && npm test && npm run lint:template
docker compose -f docker-compose.test.yml up -d --build --wait && npm run e2e; docker compose -f docker-compose.test.yml down -v
```

Expected: every command exits 0, `cfn-lint` prints nothing, Playwright reports 13 passed.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run lint, typecheck, unit, template lint, end-to-end and Docker build

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: Open source documents

**Files:**
- Create: `scripts/screenshots.ts`, `docs/screenshots/getting-started-light.png`, `docs/screenshots/getting-started-dark.png`, `docs/screenshots/connection.png`
- Create: `README.md`, `README.fr.md`, `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`, `.github/ISSUE_TEMPLATE/feature_request.yml`, `.github/ISSUE_TEMPLATE/config.yml`, `.github/pull_request_template.md`

**Interfaces:**
- Consumes: the test stack (Task 13) with the admin and connections created by the end-to-end suite (Task 14); `.env.example` (Task 13).
- Produces: repository documents only. No application code changes.

- [ ] **Step 1: Screenshot script**

Create `scripts/screenshots.ts`:

```ts
// Captures the README screenshots from a running test stack whose end-to-end suite has just run.
// Usage: docker compose -f docker-compose.test.yml up -d --build --wait && npm run e2e && npx tsx scripts/screenshots.ts
import { chromium } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3100';
const outDir = 'docs/screenshots';

async function main() {
  const browser = await chromium.launch();
  for (const colorScheme of ['light', 'dark'] as const) {
    const page = await browser.newPage({ baseURL, colorScheme, viewport: { width: 1440, height: 900 } });
    await page.goto('/en/getting-started');
    await page.screenshot({ path: `${outDir}/getting-started-${colorScheme}.png` });
    await page.close();
  }

  const page = await browser.newPage({ baseURL, viewport: { width: 1440, height: 900 } });
  await page.goto('/en/login');
  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('Password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/en\/accounts$/);
  await page.getByRole('link', { name: 'Moto role' }).click();
  await page.getByText('Connected', { exact: true }).waitFor();
  await page.screenshot({ path: `${outDir}/connection.png`, fullPage: true });
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

Run:

```bash
mkdir -p docs/screenshots
docker compose -f docker-compose.test.yml up -d --build --wait
npm run e2e
npx tsx scripts/screenshots.ts
docker compose -f docker-compose.test.yml down -v
ls docs/screenshots
```

Expected: `connection.png  getting-started-dark.png  getting-started-light.png`. Open each file and check that the page is fully rendered (no loading state, no error page).

- [ ] **Step 2: License**

Create `LICENSE`:

```
MIT License

Copyright (c) 2026 Nethanel Fitoussi

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 3: English README**

Create `README.md`:

````markdown
# OpsWatch

**Self-hosted, open source monitoring for your AWS containers, databases and logs.**

[Français](README.fr.md) · [License: MIT](LICENSE)

OpsWatch runs on your own infrastructure and reads your AWS accounts with read-only access.
Nothing leaves your network: no SaaS, no agent to install in your workloads.

![Getting started guide](docs/screenshots/getting-started-light.png)

## Status

OpsWatch is built in stages. This release covers the foundations:

| Stage | Content | Status |
|-------|---------|--------|
| 1 | Admin account, AWS connections, permission test, getting started guide (English and French) | Available |
| 2 | Containers: ECS clusters, services, tasks, load balancers | Planned |
| 3 | Databases: RDS and Aurora metrics, Performance Insights | Planned |
| 4 | Logs: CloudWatch Logs search and Logs Insights | Planned |
| 5 | Automatic analyses and on-demand snapshots saved from the dashboard | Planned |

## Quick start

Requirements: Docker with Compose v2.

```bash
git clone https://github.com/<owner>/opswatch.git
cd opswatch
cp .env.example .env
# Put at least 32 random characters in OPSWATCH_SECRET:
sed -i "s|^OPSWATCH_SECRET=.*|OPSWATCH_SECRET=$(openssl rand -base64 48 | tr -d '\n')|" .env
docker compose up -d --build
```

Open http://localhost:3000. The first visit asks you to create the admin account, then the
getting started guide walks you through connecting an AWS account.

OpsWatch refuses to start if `OPSWATCH_SECRET` is missing or shorter than 32 characters.
Keep this value safe: it encrypts stored access keys and signs sessions, and changing it
signs everyone out and makes stored keys unreadable.

## Connecting AWS

![Connection with its permission checklist](docs/screenshots/connection.png)

OpsWatch offers three methods. The guide inside the application explains each one step by step.

1. **IAM role (recommended).** OpsWatch generates a CloudFormation template that creates a
   read-only role named `OpsWatchReadOnly-<id>` in the monitored account. The role trusts only
   OpsWatch's own AWS identity, and only when it presents a random ExternalId unique to the
   connection. OpsWatch assumes the role and receives temporary credentials valid for one hour.
2. **Ambient credentials.** OpsWatch uses the identity it already runs with: an ECS task role,
   an EC2 instance profile, or a profile from a mounted `~/.aws` directory.
3. **Access keys.** An IAM user's access key pair, encrypted at rest. Use this only when the
   other two methods are not possible.

After connecting, **Run test** calls one read-only action per service and region, and shows
what OpsWatch can and cannot see.

## Security model

- Every AWS call runs on the server. Credentials never reach the browser.
- The generated role only allows read actions: the full list is in the guide and in
  `src/lib/aws/actions.ts`. OpsWatch's own identity only needs `sts:AssumeRole` on
  `arn:aws:iam::*:role/OpsWatchReadOnly-*`.
- The ExternalId prevents another OpsWatch instance, or anyone who learns the role ARN,
  from assuming the role.
- Access keys are encrypted with AES-256-GCM using a key derived from `OPSWATCH_SECRET`.
- A single admin account protects the instance. Passwords are hashed with argon2id, sessions
  expire after 12 hours of inactivity, and sign-in attempts are limited to 5 per minute per client and 20 per minute in total.
- Put OpsWatch behind HTTPS and set `OPSWATCH_PUBLIC_URL` so cookies are marked `Secure`.

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Configuration

| Variable | Required | Purpose |
|----------|----------|---------|
| `OPSWATCH_SECRET` | Yes, 32+ characters | Encrypts stored access keys and signs sessions |
| `OPSWATCH_DATA_DIR` | No, default `/data` | Location of the SQLite database |
| `OPSWATCH_PUBLIC_URL` | No | Public URL; enables `Secure` cookies over HTTPS |
| `OPSWATCH_TEMPLATE_BUCKET` | No | S3 bucket that enables the "Launch Stack" button |
| `AWS_*`, `AWS_PROFILE` | For role and ambient methods | OpsWatch's own AWS identity |
| `OPSWATCH_AWS_ENDPOINT_URL` | Tests only | Sends every AWS call to a moto server |

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
````

- [ ] **Step 4: French README**

Create `README.fr.md`:

````markdown
# OpsWatch

**Supervision open source et auto-hébergée de vos conteneurs, bases de données et journaux AWS.**

[English](README.md) · [Licence : MIT](LICENSE)

OpsWatch tourne sur votre propre infrastructure et lit vos comptes AWS en lecture seule.
Rien ne quitte votre réseau : pas de SaaS, aucun agent à installer dans vos applications.

![Guide de démarrage](docs/screenshots/getting-started-light.png)

## État du projet

OpsWatch est construit par étapes. Cette version couvre les fondations :

| Étape | Contenu | État |
|-------|---------|------|
| 1 | Compte administrateur, connexions AWS, test des permissions, guide de démarrage (anglais et français) | Disponible |
| 2 | Conteneurs : clusters, services et tâches ECS, load balancers | Prévu |
| 3 | Bases de données : métriques RDS et Aurora, Performance Insights | Prévu |
| 4 | Journaux : recherche CloudWatch Logs et Logs Insights | Prévu |
| 5 | Analyses automatiques et sauvegardes à la demande depuis le tableau de bord | Prévu |

## Démarrage rapide

Prérequis : Docker avec Compose v2.

```bash
git clone https://github.com/<owner>/opswatch.git
cd opswatch
cp .env.example .env
# Mettez au moins 32 caractères aléatoires dans OPSWATCH_SECRET :
sed -i "s|^OPSWATCH_SECRET=.*|OPSWATCH_SECRET=$(openssl rand -base64 48 | tr -d '\n')|" .env
docker compose up -d --build
```

Ouvrez http://localhost:3000. La première visite vous demande de créer le compte
administrateur, puis le guide de démarrage vous accompagne pour connecter un compte AWS.

OpsWatch refuse de démarrer si `OPSWATCH_SECRET` est absent ou fait moins de 32 caractères.
Conservez cette valeur : elle chiffre les clés d'accès enregistrées et signe les sessions.
La changer déconnecte tout le monde et rend les clés enregistrées illisibles.

## Connecter AWS

![Connexion et sa liste de permissions](docs/screenshots/connection.png)

OpsWatch propose trois méthodes. Le guide intégré à l'application détaille chacune étape par étape.

1. **Rôle IAM (recommandé).** OpsWatch génère un modèle CloudFormation qui crée un rôle en
   lecture seule nommé `OpsWatchReadOnly-<id>` dans le compte supervisé. Le rôle ne fait
   confiance qu'à l'identité AWS d'OpsWatch, et seulement si elle présente un ExternalId
   aléatoire propre à la connexion. OpsWatch assume le rôle et reçoit des identifiants
   temporaires valables une heure.
2. **Identifiants ambiants.** OpsWatch utilise l'identité avec laquelle il tourne déjà : rôle
   de tâche ECS, profil d'instance EC2, ou profil d'un répertoire `~/.aws` monté.
3. **Clés d'accès.** La paire de clés d'un utilisateur IAM, chiffrée au repos. À n'utiliser
   que si les deux autres méthodes sont impossibles.

Une fois connecté, **Lancer le test** appelle une action en lecture par service et par
région, et montre ce qu'OpsWatch peut voir ou non.

## Modèle de sécurité

- Tous les appels AWS s'exécutent côté serveur. Les identifiants n'atteignent jamais le navigateur.
- Le rôle généré n'autorise que des actions de lecture : la liste complète figure dans le
  guide et dans `src/lib/aws/actions.ts`. L'identité d'OpsWatch n'a besoin que de
  `sts:AssumeRole` sur `arn:aws:iam::*:role/OpsWatchReadOnly-*`.
- L'ExternalId empêche une autre instance d'OpsWatch, ou toute personne connaissant l'ARN du
  rôle, de l'assumer.
- Les clés d'accès sont chiffrées en AES-256-GCM avec une clé dérivée de `OPSWATCH_SECRET`.
- Un unique compte administrateur protège l'instance. Les mots de passe sont hachés avec
  argon2id, les sessions expirent après 12 heures d'inactivité, et les tentatives de connexion
  sont limitées à 5 par minute par client et 20 par minute au total.
- Placez OpsWatch derrière HTTPS et définissez `OPSWATCH_PUBLIC_URL` pour que les cookies
  soient marqués `Secure`.

Signalez les vulnérabilités en privé comme indiqué dans [SECURITY.md](SECURITY.md).

## Configuration

| Variable | Obligatoire | Rôle |
|----------|-------------|------|
| `OPSWATCH_SECRET` | Oui, 32 caractères minimum | Chiffre les clés d'accès et signe les sessions |
| `OPSWATCH_DATA_DIR` | Non, `/data` par défaut | Emplacement de la base SQLite |
| `OPSWATCH_PUBLIC_URL` | Non | URL publique ; active les cookies `Secure` en HTTPS |
| `OPSWATCH_TEMPLATE_BUCKET` | Non | Bucket S3 qui active le bouton « Launch Stack » |
| `AWS_*`, `AWS_PROFILE` | Pour les méthodes rôle et ambiante | Identité AWS propre à OpsWatch |
| `OPSWATCH_AWS_ENDPOINT_URL` | Tests uniquement | Envoie tous les appels AWS vers un serveur moto |

## Développement

Voir [CONTRIBUTING.md](CONTRIBUTING.md) (en anglais).

## Licence

[MIT](LICENSE)
````

- [ ] **Step 5: Contributing and security policy**

Create `CONTRIBUTING.md`:

````markdown
# Contributing to OpsWatch

Thanks for helping. Bug reports, translations, documentation and code are all welcome.

## Setup

Requirements: Node.js 22.12 or later (see `.nvmrc`), npm, Docker.

```bash
npm ci
cp .env.example .env.local
# Set OPSWATCH_SECRET in .env.local to at least 32 random characters,
# and OPSWATCH_DATA_DIR to a local folder such as ./data
npm run dev
```

The app runs on http://localhost:3000.

## Tests

| Command | What it runs |
|---------|--------------|
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript in strict mode |
| `npm test` | Unit tests (Vitest). AWS calls are mocked with `aws-sdk-client-mock` |
| `npm run lint:template` | Generates a sample CloudFormation template and checks it with `cfn-lint` (needs Docker) |
| `npm run e2e` | Playwright against the test stack, see below |

End-to-end tests run against the Docker image, with AWS replaced by a local moto server:

```bash
docker compose -f docker-compose.test.yml up -d --build --wait
npx playwright install chromium
npm run e2e
docker compose -f docker-compose.test.yml down -v
```

Start from a fresh stack each time: the suite creates the admin account.

## Conventions

- Write the failing test first, then the code.
- Every user-visible text lives in `messages/en.json` and `messages/fr.json`. A unit test
  fails if the two files do not have the same keys.
- Any new AWS call needs its IAM action added to `src/lib/aws/actions.ts`. That catalogue
  feeds both the generated template and the guide, so they never drift apart. Adding an
  action requires bumping `TEMPLATE_VERSION`.
- OpsWatch only reads. Pull requests that add write actions on customer accounts are declined.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):
  `feat:`, `fix:`, `docs:`, `test:`, `build:`, `ci:`, `refactor:`, `chore:`.
- Keep pull requests focused on one change and fill in the template.

## Reporting security issues

Do not open a public issue. Follow [SECURITY.md](SECURITY.md).
````

Create `SECURITY.md`:

```markdown
# Security policy

## Supported versions

Security fixes are released for the latest minor version only.

## Reporting a vulnerability

Please do not report vulnerabilities in public issues, discussions or pull requests.

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and
choose **Report a vulnerability**. Include the affected version, the steps to reproduce and
the impact you expect.

You will receive an acknowledgement within 5 working days. We will keep you informed while
we prepare a fix and credit you in the release notes unless you prefer otherwise.

## Scope

In scope: the OpsWatch application, its Docker image and the CloudFormation template it generates.

Out of scope: vulnerabilities in AWS itself, and deployments that ignore the documented
requirements (for example an instance exposed without HTTPS or with a weak `OPSWATCH_SECRET`).
```

- [ ] **Step 6: Issue and pull request templates**

Create `.github/ISSUE_TEMPLATE/bug_report.yml`:

```yaml
name: Bug report
description: Something does not work as documented.
labels: [bug]
body:
  - type: markdown
    attributes:
      value: |
        Do not include access keys, ExternalIds, role ARNs or account IDs you want to keep private.
        For security issues, follow SECURITY.md instead.
  - type: input
    id: version
    attributes:
      label: OpsWatch version
      description: Image tag or commit.
    validations:
      required: true
  - type: dropdown
    id: method
    attributes:
      label: Connection method
      options:
        - IAM role
        - Ambient credentials
        - Access keys
        - Not related to a connection
    validations:
      required: true
  - type: textarea
    id: steps
    attributes:
      label: Steps to reproduce
      placeholder: "1. Go to …\n2. Click …"
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: Expected and actual behaviour
    validations:
      required: true
  - type: textarea
    id: logs
    attributes:
      label: Container logs
      description: Output of `docker compose logs opswatch`, with secrets removed.
      render: text
```

Create `.github/ISSUE_TEMPLATE/feature_request.yml`:

```yaml
name: Feature request
description: Suggest an improvement.
labels: [enhancement]
body:
  - type: textarea
    id: problem
    attributes:
      label: Problem
      description: What are you trying to do, and what gets in the way?
    validations:
      required: true
  - type: textarea
    id: proposal
    attributes:
      label: Proposal
      description: What would you like OpsWatch to do? Mention any extra IAM action it would need.
    validations:
      required: true
```

Create `.github/ISSUE_TEMPLATE/config.yml`:

```yaml
blank_issues_enabled: false
```

Create `.github/pull_request_template.md`:

```markdown
## What and why

## How it was tested

- [ ] `npm run lint`, `npm run typecheck` and `npm test` pass
- [ ] `npm run e2e` passes, if the change touches pages or AWS calls
- [ ] New texts exist in both `messages/en.json` and `messages/fr.json`
- [ ] New AWS calls have their IAM action in `src/lib/aws/actions.ts` and `TEMPLATE_VERSION` was bumped
```

- [ ] **Step 7: Check links and commit**

Run:

```bash
for f in README.md README.fr.md CONTRIBUTING.md; do
  grep -o '](\([^)#]*\))' "$f" | sed 's/](\(.*\))/\1/' | grep -v '^http' | while read -r target; do
    test -e "$target" || echo "$f: missing $target"
  done
done
```

Expected: no output.

```bash
git add -A
git commit -m "docs: add README in English and French, license, contributing and security policy

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Definition of done checklist

Run through this list once Task 16 is committed. Each line maps to spec §13.

- [ ] `cp .env.example .env`, set `OPSWATCH_SECRET`, `docker compose up -d --build`: http://localhost:3000 answers. With the secret removed, the container exits with code 1.
- [ ] First visit creates the admin; afterwards `/en/accounts` requires login and `/en/getting-started` stays public.
- [ ] The guide is complete in English and French, and the diagram explains each node on hover, focus and click.
- [ ] A connection can be created with each of the three methods, and **Run test** shows the per-service checklist (role and access keys covered by the end-to-end suite; ambient checked manually with the test stack's `testing` credentials).
- [ ] `npm run lint:template` passes.
- [ ] The CI workflow is green on the first pull request.
- [ ] Manual validation against a real AWS account is left to the owner: deploy the generated stack, paste the role ARN, run the test.
