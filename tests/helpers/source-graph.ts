import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const SRC = path.join(ROOT, 'src');

export function sourceFiles(dir: string = SRC): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

export const readSource = (file: string) => fs.readFileSync(file, 'utf8');

export const directive = (source: string) => source.match(/^\s*['"]use (client|server)['"]/)?.[1];

/** Specifiers of the value imports and re-exports of a module (`import type` is erased, so it is skipped). */
export function valueImports(source: string): string[] {
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

/** Every file that runs in the browser: 'use client' modules and what they import, stopping at Server Action modules. */
export function clientModuleGraph(): { modules: Set<string>; packages: Map<string, string> } {
  const modules = new Set<string>();
  const packages = new Map<string, string>();
  const visit = (file: string, entry: boolean) => {
    if (modules.has(file)) return;
    const source = readSource(file);
    if (!entry && directive(source) === 'server') return;
    modules.add(file);
    for (const specifier of valueImports(source)) {
      const local = resolveLocal(file, specifier);
      if (local) visit(local, false);
      else if (!specifier.startsWith('.') && !specifier.startsWith('@/')) packages.set(`${specifier} <- ${path.relative(ROOT, file)}`, specifier);
    }
  };
  for (const file of sourceFiles()) {
    if (directive(readSource(file)) === 'client') visit(file, true);
  }
  return { modules, packages };
}
