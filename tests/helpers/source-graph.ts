import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
export const SRC = path.join(ROOT, 'src');
/** The shared contract package. It sits outside `src` because the mobile application reads the same files. */
export const CONTRACT = path.join(ROOT, 'packages/contract');

function sourceFiles(dir: string = SRC): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Every TypeScript file under `src/<relative>`, whether or not anything imports it. */
export function sourceFilesUnder(relative: string): string[] {
  return sourceFiles(path.join(SRC, relative)).sort();
}

/** Every TypeScript file under an absolute directory, for the trees that live outside `src`. */
export function typescriptFilesIn(directory: string): string[] {
  return sourceFiles(directory).sort();
}

export const readSource = (file: string) => fs.readFileSync(file, 'utf8');

const directive = (source: string) => source.match(/^\s*['"]use (client|server)['"]/)?.[1];

/** Specifiers of the value imports and re-exports of a module (`import type` is erased, so it is skipped). */
export function valueImports(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /^(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
  for (const match of source.matchAll(pattern)) {
    if (!match[1]) specifiers.push(match[2]);
  }
  return specifiers;
}

/** Every specifier a module names, `import type` included: a type-only import still ties two trees together. */
export function allImports(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /^(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
  for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
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

/**
 * The entries plus everything they import, following local specifiers and stopping at Server Action modules
 * (a 'use server' module is an RPC stub on the other side, so its own imports do not travel). Every external
 * specifier met on the way is collected with the file that pulled it in.
 */
export function moduleGraph(entries: readonly string[]): { modules: Set<string>; packages: Map<string, string> } {
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
  for (const entry of entries) visit(entry, true);
  return { modules, packages };
}

/** Every file that runs in the browser: 'use client' modules and what they import. */
export function clientModuleGraph(): { modules: Set<string>; packages: Map<string, string> } {
  return moduleGraph(sourceFiles().filter((file) => directive(readSource(file)) === 'client'));
}
