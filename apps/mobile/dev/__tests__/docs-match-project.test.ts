/**
 * The documentation is checked against the project, not trusted.
 *
 * Every command, path, script, identifier and environment variable in `docs/mobile/` is something a reader will
 * copy and run. Each one is a claim about this repository, and claims rot: a script gets renamed, a file moves, a
 * profile is added to `eas.json` and nobody updates the table. These assertions turn that rot into a failing test
 * instead of a developer's wasted afternoon.
 *
 * What this cannot check is whether a command *works* — only that the thing it names still exists. Whether it works
 * is recorded, with dates, in testing.md's "What has actually been verified".
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MOBILE = resolve(__dirname, '../..');
const REPO = resolve(MOBILE, '../..');
const DOCS = join(REPO, 'docs/mobile');

const docFiles = readdirSync(DOCS).filter((name) => name.endsWith('.md'));
const docs = docFiles.map((name) => ({ name, text: readFileSync(join(DOCS, name), 'utf8') }));
const allDocs = docs.map((d) => d.text).join('\n');

const pkg = JSON.parse(readFileSync(join(MOBILE, 'package.json'), 'utf8')) as { scripts: Record<string, string>; engines?: Record<string, string> };
/** The server's own scripts: the docs tell a reader how to run an OpsWatch server to point the app at. */
const rootPkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
const eas = JSON.parse(readFileSync(join(MOBILE, 'eas.json'), 'utf8')) as { build: Record<string, unknown>; cli?: Record<string, unknown> };
const appConfig = readFileSync(join(MOBILE, 'app.config.ts'), 'utf8');

/** Fenced code blocks only: prose may discuss a command that is deliberately not ours to run. */
function codeBlocks(text: string): string[] {
  return [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]!);
}

it('documents no npm script this app does not have', () => {
  const missing: string[] = [];
  for (const { name, text } of docs) {
    for (const block of codeBlocks(text)) {
      for (const run of block.matchAll(/\bnpm run ([a-z][a-z0-9:-]*)/g)) {
        const script = run[1]!;
        if (!(script in pkg.scripts) && !(script in rootPkg.scripts)) missing.push(`${name}: npm run ${script}`);
      }
    }
  }
  expect(missing).toEqual([]);
});

it('mentions every npm script at least once, so nothing useful stays undiscovered', () => {
  const undocumented = Object.keys(pkg.scripts).filter((script) => !allDocs.includes(`npm run ${script}`));
  expect(undocumented).toEqual([]);
});

it('names only EAS build profiles that exist, and documents all of them', () => {
  const profiles = Object.keys(eas.build);
  const documented = profiles.filter((profile) => new RegExp(`\`${profile}\``).test(allDocs));
  expect(documented.sort()).toEqual(profiles.sort());

  const named = new Set([...allDocs.matchAll(/--profile[= ]([a-z][a-z0-9-]*)/g)].map((m) => m[1]!));
  expect([...named].filter((profile) => !profiles.includes(profile))).toEqual([]);
});

it('uses the same placeholder identifier as app.config.ts', () => {
  const placeholder = appConfig.match(/const PLACEHOLDER_ID = '([^']+)'/)?.[1];
  expect(placeholder).toBeDefined();
  // Any `com.example.*` the docs mention must be that one, or readers will replace the wrong string.
  const mentioned = new Set([...allDocs.matchAll(/com\.example\.[a-z.]+/g)].map((m) => m[0]!));
  expect([...mentioned]).toEqual([placeholder]);
});

/** Environment variables are the one place a wrong name costs a build rather than a page refresh. */
it('documents exactly the environment variables the config reads', () => {
  const read = new Set([...appConfig.matchAll(/env\('([A-Z0-9_]+)'\)/g)].map((m) => m[1]!));
  // Read elsewhere in the project rather than by app.config.ts: the parity run points at a contract checkout, and
  // the mock server takes a port.
  for (const name of ['OPSWATCH_CONTRACT_DIR']) read.add(name);
  // EAS sets this one for us; it is not something a reader ever sets.
  read.delete('EAS_BUILD_PROFILE');
  const undocumented = [...read].filter((name) => !allDocs.includes(name));
  expect(undocumented).toEqual([]);

  const invented = new Set([...allDocs.matchAll(/\b(OPSWATCH_[A-Z0-9_]+|EXPO_PUBLIC_[A-Z0-9_]+)\b/g)].map((m) => m[1]!));
  const serverSide = new Set(['OPSWATCH_SECRET', 'OPSWATCH_DATA_DIR', 'OPSWATCH_PUBLIC_URL']);
  expect([...invented].filter((name) => !read.has(name) && !serverSide.has(name))).toEqual([]);
});

/** Files the reader creates themselves, which are git-ignored and must therefore be absent from a clean checkout. */
const CREATED_BY_THE_READER = new Set(['apps/mobile/.env']);

it('links and code blocks only name files that exist', () => {
  const missing: string[] = [];
  for (const { name, text } of docs) {
    for (const match of text.matchAll(/`(apps\/mobile\/[A-Za-z0-9._/-]+|docs\/mobile\/[A-Za-z0-9._/-]+|dev\/[A-Za-z0-9._/-]+|e2e\/[A-Za-z0-9._/-]+)`/g)) {
      const path = match[1]!;
      if (CREATED_BY_THE_READER.has(path)) continue;
      const candidates = [join(REPO, path), join(MOBILE, path)];
      if (!candidates.some(existsSync)) missing.push(`${name}: ${path}`);
    }
  }
  expect(missing).toEqual([]);
});

it('keeps the documented Node version in step with package.json and eas.json', () => {
  const required = pkg.engines?.node;
  expect(required).toBeDefined();
  const major = required!.match(/(\d+)/)?.[1];
  expect(allDocs).toContain(`Node ${major}`);

  const easNode = (eas.build.base as { node?: string } | undefined)?.node;
  if (easNode) expect(allDocs).toContain(easNode);
});

it('keeps the mobile .env.example in step with what the app reads', () => {
  const example = join(MOBILE, '.env.example');
  expect(existsSync(example)).toBe(true);
  const text = readFileSync(example, 'utf8');
  // Only client-visible configuration belongs in a file a developer copies to .env.
  expect(text).toContain('EXPO_PUBLIC_DEFAULT_SERVER_URL');
  for (const forbidden of ['AWS_SECRET', 'AWS_ACCESS_KEY', 'GITHUB_TOKEN', 'CLOUDFLARE', 'ANTHROPIC', 'OPENAI']) {
    expect(text).not.toContain(forbidden);
  }
});

/**
 * The root README is where someone lands first, so the mobile app has to be findable from it and every link it makes
 * has to work. A mobile document renamed or removed without updating the README leaves the only entry point broken.
 */
describe('the root README', () => {
  const readme = readFileSync(join(REPO, 'README.md'), 'utf8');

  it('points at the mobile documentation', () => {
    expect(readme).toContain('docs/mobile/README.md');
    expect(readme).toMatch(/##\s+Mobile app/);
  });

  it('links only to mobile documents that exist', () => {
    const broken = [...readme.matchAll(/\]\((docs\/mobile\/[A-Za-z0-9._-]+\.md)(?:#[^)]*)?\)/g)]
      .map((m) => m[1]!)
      .filter((path) => !existsSync(join(REPO, path)));
    expect([...new Set(broken)]).toEqual([]);
  });

  it('names every mobile document that a reader should be able to reach', () => {
    const reachable = new Set([...readme.matchAll(/docs\/mobile\/([A-Za-z0-9._-]+\.md)/g)].map((m) => m[1]!));
    // Internal notes are reached from the mobile README, not the root one.
    const internal = new Set(['merge-notes.md', 'RECOVERY.md', 'CHANGELOG.md', 'api-contract.md', 'architecture.md', 'app-identity.md', 'notifications.md']);
    const unreachable = docFiles.filter((name) => !reachable.has(name) && !internal.has(name));
    expect(unreachable).toEqual([]);
  });
});
