import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SRC = path.join(ROOT, 'src');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const read = (file: string) => fs.readFileSync(file, 'utf8');
const directive = (source: string) => source.match(/^\s*['"]use (client|server)['"]/)?.[1];

/** Specifiers of the value imports and re-exports of a module (`import type` is erased, so it is skipped). */
function valueImports(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /^(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
  for (const match of source.matchAll(pattern)) {
    if (!match[1]) specifiers.push(match[2]);
  }
  return specifiers;
}

function resolveLocal(from: string, specifier: string): string | null {
  const base = specifier.startsWith('@/')
    ? path.join(SRC, specifier.slice(2))
    : specifier.startsWith('.')
      ? path.resolve(path.dirname(from), specifier)
      : null;
  if (!base) return null;
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
}

/** Packages reached from a client component, following local modules but not Server Action modules. */
function clientPackages(entry: string): Map<string, string> {
  const packages = new Map<string, string>();
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = read(file);
    if (file !== entry && directive(source) === 'server') return;
    for (const specifier of valueImports(source)) {
      const local = resolveLocal(file, specifier);
      if (local) visit(local);
      else if (!specifier.startsWith('.') && !specifier.startsWith('@/')) packages.set(specifier, path.relative(ROOT, file));
    }
  };
  visit(entry);
  return packages;
}

const SERVER_ONLY_MODULES = [
  'lib/env.ts',
  'lib/crypto.ts',
  'lib/auth/admin.ts',
  'lib/auth/sessions.ts',
  'lib/auth/password.ts',
  'lib/auth/actions.ts',
  'lib/auth/current.ts',
  'lib/auth/login-limiter.ts',
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
];

describe('module boundaries', () => {
  it.each(SERVER_ONLY_MODULES)('%s is marked server-only', (file) => {
    expect(valueImports(read(path.join(SRC, file)))).toContain('server-only');
  });

  it('keeps Zod, AWS, Node and server-only modules out of every client component', () => {
    const forbidden = /^(zod|server-only|node:|@aws-sdk\/|@node-rs\/|better-sqlite3|drizzle-orm)/;
    const clientFiles = sourceFiles(SRC).filter((file) => directive(read(file)) === 'client');
    expect(clientFiles.length).toBeGreaterThan(5);
    const leaks = clientFiles.flatMap((file) =>
      [...clientPackages(file)]
        .filter(([specifier]) => forbidden.test(specifier))
        .map(([specifier, importer]) => `${path.relative(ROOT, file)} -> ${importer} -> ${specifier}`),
    );
    expect(leaks).toEqual([]);
  });
});
