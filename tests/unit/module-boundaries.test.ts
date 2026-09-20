import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRC, clientModuleGraph, moduleGraph, readSource, sourceFilesUnder, valueImports } from '../helpers/source-graph';

/** Never reachable from the browser, and never imported by a module that is. */
const FORBIDDEN_IN_CLIENT = /^(zod|server-only|node:|@aws-sdk\/|@node-rs\/|better-sqlite3|drizzle-orm|next-intl\/server)/;

/** The two directories whose side is fixed by the spec, checked file by file so an unconsumed module counts too. */
const CLIENT_SAFE_DIR = 'lib/monitoring/shared';
const SERVER_ONLY_DIR = 'lib/analysis';
const relative = (file: string) => path.relative(SRC, file);

/**
 * §9.6: the store is the only SQL in the product. Nothing above it may reach the driver or the schema, and nothing
 * outside it may name `.$client` — that is the escape hatch, and it belongs behind the repository like the rest.
 */
const STORE_ONLY = /^(better-sqlite3|drizzle-orm)/;
const STORE_DIRS = ['lib/db', 'lib/store'];

/**
 * The repositories that predate the store layer. They are the same thing the rule asks for — every query behind a
 * function, and not one of them reaches for `.$client` — they simply live beside the feature that owns them rather
 * than under `lib/store/`. Moving them is a refactor of its own, so they are named here instead of being allowed
 * silently. **This list is closed: a new module that wants SQL belongs in `lib/store/`.**
 */
const REPOSITORIES_OUTSIDE_THE_STORE = [
  'lib/auth/admin.ts',
  'lib/auth/sessions.ts',
  'lib/connections/repository.ts',
  'lib/settings/repository.ts',
].map((file) => file.split('/').join(path.sep));

const SERVER_ONLY_MODULES = [
  'lib/env.ts',
  'lib/crypto.ts',
  'lib/auth/admin.ts',
  'lib/auth/sessions.ts',
  'lib/auth/password.ts',
  'lib/auth/actions.ts',
  'lib/auth/current.ts',
  'lib/auth/google.ts',
  'lib/auth/login-limiter.ts',
  'lib/auth/route.ts',
  'lib/auth/login.ts',
  'lib/store/tx.ts',
  'lib/store/problems.ts',
  'lib/api/v1/envelope.ts',
  'lib/api/v1/features.ts',
  'lib/api/v1/handler.ts',
  'lib/api/v1/openapi.ts',
  'lib/api/v1/request.ts',
  'lib/api/v1/routes.ts',
  'lib/api/v1/server-info.ts',
  'lib/net/safe-fetch.ts',
  'lib/read/environments.ts',
  'lib/aws/base-credentials.ts',
  'lib/aws/credentials.ts',
  'lib/aws/identity.ts',
  'lib/aws/permissions.ts',
  'lib/aws/template-upload.ts',
  'lib/connections/repository.ts',
  'lib/connections/resolver.ts',
  'lib/connections/test-connection.ts',
  'lib/connections/template.ts',
  'lib/db/client.ts',
  'lib/settings/repository.ts',
  'lib/monitoring/result.ts',
  'lib/monitoring/cache.ts',
  'lib/monitoring/call.ts',
  'lib/monitoring/metrics.ts',
  'lib/monitoring/alarms.ts',
  'lib/monitoring/selection.ts',
  'lib/monitoring/target.ts',
  'lib/monitoring/route.ts',
  'lib/monitoring/ecs.ts',
  'lib/monitoring/elb.ts',
  'lib/monitoring/rds.ts',
  'lib/monitoring/instance-memory.ts',
  'lib/monitoring/pi.ts',
  'lib/monitoring/evaluate.ts',
  'lib/monitoring/insights.ts',
  'lib/monitoring/overview.ts',
  'lib/monitoring/logs.ts',
  'lib/monitoring/query-bindings.ts',
  'lib/monitoring/logs-route.ts',
];

describe('module boundaries', () => {
  it.each(SERVER_ONLY_MODULES)('%s is marked server-only', (file) => {
    expect(valueImports(readSource(path.join(SRC, file)))).toContain('server-only');
  });

  it('keeps Zod, AWS, Node and server-only modules out of every client component', () => {
    const { modules, packages } = clientModuleGraph();
    expect(modules.size).toBeGreaterThan(5);
    expect([...packages].filter(([, specifier]) => FORBIDDEN_IN_CLIENT.test(specifier)).map(([where]) => where)).toEqual([]);
  });

  // The client graph above only reaches what a 'use client' module already imports, so a shared module written
  // ahead of its consumer would go unchecked until the day it is used. Both directories are therefore walked
  // from disk instead: every file, consumed or not.
  it(`keeps every module under ${CLIENT_SAFE_DIR} client-safe, consumed or not`, () => {
    const entries = sourceFilesUnder(CLIENT_SAFE_DIR);
    expect(entries.length).toBeGreaterThan(5);
    const { packages } = moduleGraph(entries);
    expect([...packages].filter(([, specifier]) => FORBIDDEN_IN_CLIENT.test(specifier)).map(([where]) => where)).toEqual([]);
  });

  it.each(sourceFilesUnder(SERVER_ONLY_DIR).map(relative))('%s is server-only, consumed or not', (file) => {
    expect(valueImports(readSource(path.join(SRC, file)))).toContain('server-only');
  });

  it('keeps SQL and better-sqlite3 below the store layer', () => {
    const offenders: string[] = [];
    for (const file of sourceFilesUnder('lib')) {
      const rel = relative(file);
      if (STORE_DIRS.some((dir) => rel.startsWith(dir + path.sep))) continue;
      const source = readSource(file);
      const mayQuery = REPOSITORIES_OUTSIDE_THE_STORE.includes(rel);
      if (!mayQuery && valueImports(source).some((specifier) => STORE_ONLY.test(specifier))) offenders.push(rel);
      if (source.includes('.$client')) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it.each(REPOSITORIES_OUTSIDE_THE_STORE)('%s is still a repository, so the exception still earns its place', (file) => {
    // An entry that stopped importing drizzle has been migrated or deleted: take it off the list rather than let
    // the exception outlive the debt it records.
    expect(valueImports(readSource(path.join(SRC, file))).some((specifier) => STORE_ONLY.test(specifier))).toBe(true);
  });

  it('finds the files of both directories', () => {
    expect(sourceFilesUnder(SERVER_ONLY_DIR).map(relative)).toContain(path.join(SERVER_ONLY_DIR, 'markdown.ts'));
    expect(sourceFilesUnder(CLIENT_SAFE_DIR).map(relative)).toContain(path.join(CLIENT_SAFE_DIR, 'facets.ts'));
  });
});
