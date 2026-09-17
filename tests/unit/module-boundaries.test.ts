import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRC, clientModuleGraph, readSource, valueImports } from '../helpers/source-graph';

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
  'lib/monitoring/result.ts',
  'lib/monitoring/cache.ts',
  'lib/monitoring/call.ts',
  'lib/monitoring/metrics.ts',
  'lib/monitoring/alarms.ts',
  'lib/monitoring/selection.ts',
  'lib/monitoring/target.ts',
  'lib/monitoring/route.ts',
];

describe('module boundaries', () => {
  it.each(SERVER_ONLY_MODULES)('%s is marked server-only', (file) => {
    expect(valueImports(readSource(path.join(SRC, file)))).toContain('server-only');
  });

  it('keeps Zod, AWS, Node and server-only modules out of every client component', () => {
    const forbidden = /^(zod|server-only|node:|@aws-sdk\/|@node-rs\/|better-sqlite3|drizzle-orm|next-intl\/server)/;
    const { modules, packages } = clientModuleGraph();
    expect(modules.size).toBeGreaterThan(5);
    expect([...packages].filter(([, specifier]) => forbidden.test(specifier)).map(([where]) => where)).toEqual([]);
  });
});
