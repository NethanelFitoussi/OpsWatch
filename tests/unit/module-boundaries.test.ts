import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRC, clientModuleGraph, moduleGraph, readSource, sourceFilesUnder, valueImports } from '../helpers/source-graph';

/** Never reachable from the browser, and never imported by a module that is. */
const FORBIDDEN_IN_CLIENT = /^(zod|server-only|node:|@aws-sdk\/|@node-rs\/|better-sqlite3|drizzle-orm|next-intl\/server)/;

/** The two directories whose side is fixed by the spec, checked file by file so an unconsumed module counts too. */
const CLIENT_SAFE_DIR = 'lib/monitoring/shared';
const SERVER_ONLY_DIR = 'lib/analysis';
const relative = (file: string) => path.relative(SRC, file);

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

  it('finds the files of both directories', () => {
    expect(sourceFilesUnder(SERVER_ONLY_DIR).map(relative)).toContain(path.join(SERVER_ONLY_DIR, 'markdown.ts'));
    expect(sourceFilesUnder(CLIENT_SAFE_DIR).map(relative)).toContain(path.join(CLIENT_SAFE_DIR, 'facets.ts'));
  });
});
