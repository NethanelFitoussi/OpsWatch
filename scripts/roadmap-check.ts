/**
 * `npm run roadmap:check` — structural drift between the roadmap and the repository.
 *
 * What this is for: the audit in `docs/superpowers/audits/full-roadmap-status.md` is true on the day it is
 * written and decays from then on. This checks the part of it a machine can decide, so the decay is caught
 * rather than discovered months later by a user clicking a menu entry that leads nowhere.
 *
 * **What it deliberately does not do.** It never claims a feature is complete. Completeness is a product
 * judgement — whether a page tells the truth, whether the empty state is honest, whether an operator can
 * actually do the thing — and a script that scored that would be worse than no script, because its green
 * would be believed. Every check here is a structural fact with one right answer, and everything else is
 * printed as "needs human acceptance" with no verdict attached.
 *
 * Deterministic and CI-safe: it reads files, never the network, never Docker, never a clock.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { LIST_FILTERS, FEATURES, filtersFor } from '../packages/contract';

export type Finding = { check: string; detail: string };
export type CheckResult = { failures: Finding[]; notes: Finding[] };

const ROOT = join(import.meta.dirname, '..');
const ROUTES = join(ROOT, 'src/app/[locale]/(app)/c/[connectionId]/[region]');
const API_V1 = join(ROOT, 'src/app/api/v1');

const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/** Every file under a directory, recursively. Used to look for markers in shipped source. */
function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === '.next') continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * The section catalogue, parsed from its own source rather than imported: importing it would pull
 * `server-only` into a plain Node script, and the shape here is simple enough to read directly.
 */
function sections(): { subsections: Record<string, string[]>; unbuilt: string[] } {
  const source = read('src/lib/monitoring/shared/sections.ts');
  const subsections: Record<string, string[]> = {};
  const block = source.slice(source.indexOf('export const SUBSECTIONS'), source.indexOf('} as const satisfies'));
  for (const [, section, list] of block.matchAll(/^\s*'?([a-z-]+)'?:\s*\[([^\]]+)\]/gm)) {
    subsections[section] = [...list.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  }
  const unbuiltBlock = source.slice(source.indexOf('UNBUILT_SUBSECTIONS'), source.indexOf('export function isSubsectionBuilt'));
  const unbuilt = [...unbuiltBlock.matchAll(/'([a-z-]+\/[a-z-]+)'/g)].map((match) => match[1]);
  return { subsections, unbuilt };
}

/**
 * Every segment the menu offers either has a page or is declared unbuilt — and never both.
 *
 * Both directions are failures for the same reason: the menu is a promise. A segment with no page answers
 * 404 to somebody who clicked it, and a built page still marked unbuilt is a feature nobody can reach.
 */
function checkSections(): CheckResult {
  const { subsections, unbuilt } = sections();
  const failures: Finding[] = [];
  for (const [section, segments] of Object.entries(subsections)) {
    for (const segment of segments) {
      const entry = `${section}/${segment}`;
      const hasPage = existsSync(join(ROUTES, section, segment, 'page.tsx'));
      const declaredUnbuilt = unbuilt.includes(entry);
      if (hasPage && declaredUnbuilt) {
        failures.push({ check: 'section-catalogue', detail: `${entry} has a page but is still in UNBUILT_SUBSECTIONS, so the menu refuses to link to it` });
      }
      if (!hasPage && !declaredUnbuilt) {
        failures.push({ check: 'section-catalogue', detail: `${entry} is linked from the menu but has no page.tsx, so it answers 404` });
      }
    }
    // A section root redirects to its first segment, so that one must exist whatever else does not.
    const first = segments[0];
    if (first !== undefined && unbuilt.includes(`${section}/${first}`)) {
      failures.push({ check: 'section-catalogue', detail: `${section} defaults to ${first}, which is declared unbuilt: the section root would redirect to a 404` });
    }
  }
  return { failures, notes: [] };
}

/** A filter the contract declares must be read by its route, or it is silently dropped (the 2026-09-22 bug). */
function checkFilters(): CheckResult {
  const failures: Finding[] = [];
  for (const path of Object.keys(LIST_FILTERS)) {
    const route = join(API_V1, path.replace(/^\//, ''), 'route.ts');
    if (!existsSync(route)) {
      failures.push({ check: 'list-filters', detail: `${path} declares filters but has no route at ${relative(ROOT, route)}` });
      continue;
    }
    const source = readFileSync(route, 'utf8');
    if (!source.includes('parseListFilters')) {
      failures.push({ check: 'list-filters', detail: `${path} declares filters but its route never calls parseListFilters, so they are dropped` });
    }
    for (const name of Object.keys(filtersFor(path) ?? {})) {
      // The parser reads them generically; this only catches a filter declared for an endpoint that cannot use it.
      if (name.length === 0) failures.push({ check: 'list-filters', detail: `${path} declares an empty filter name` });
    }
  }
  return { failures, notes: [] };
}

/** A capability flagged as implemented must have a route behind it; one that is not must not be advertised. */
function checkCapabilities(): CheckResult {
  const source = read('src/lib/api/v1/features.ts');
  const block = source.slice(source.indexOf('const IMPLEMENTED'), source.indexOf('/** What the operator has configured'));
  const implemented = new Map<string, boolean>();
  for (const [, name, value] of block.matchAll(/^\s*(\w+):\s*(true|false),/gm)) implemented.set(name, value === 'true');

  const failures: Finding[] = [];
  const notes: Finding[] = [];
  for (const feature of FEATURES) {
    if (!implemented.has(feature)) {
      failures.push({ check: 'capabilities', detail: `${feature} is in the contract's FEATURES but absent from IMPLEMENTED` });
      continue;
    }
    if (!implemented.get(feature)) continue;
    // `environments` is served at /environments; the rest follow their own name. A feature may serve from
    // a sub-path — `/ai/ask`, `/me/preferences` — so any route under its directory counts as serving it.
    const roots = [join(API_V1, feature), join(API_V1, feature.replace(/s$/, ''))];
    const served = roots.some((root) => walk(root).some((file) => file.endsWith(`route.ts`)));
    if (!served) {
      failures.push({ check: 'capabilities', detail: `${feature} is advertised as implemented but has no /api/v1/${feature} route` });
    }
  }
  for (const [name, value] of implemented) {
    if (!value) notes.push({ check: 'capabilities', detail: `${name} is advertised as not implemented — intentional until it is built` });
  }
  return { failures, notes };
}

/** Placeholder markers in shipped source. A stub that reaches a user is the thing this whole audit is about. */
function checkMarkers(): CheckResult {
  const MARKERS = ['@stub', 'NOT_IMPLEMENTED', 'FIXME', 'HACK:'];
  const failures: Finding[] = [];
  for (const file of walk(join(ROOT, 'src'))) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    const source = readFileSync(file, 'utf8');
    for (const marker of MARKERS) {
      if (source.includes(marker)) failures.push({ check: 'markers', detail: `${relative(ROOT, file)} contains ${marker}` });
    }
  }
  return { failures, notes: [] };
}

/**
 * A contract schema nobody produces.
 *
 * The contract is allowed to describe more than the server serves — that is how mobile is built ahead of a
 * surface. So this is a **note**, never a failure: it says what the contract promises that nothing answers,
 * which is exactly the list the roadmap cares about.
 */
function checkSchemaProducers(): CheckResult {
  const served = new Set(
    walk(API_V1)
      .filter((file) => file.endsWith('route.ts'))
      .flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/(\w+Schema)\b/g)].map((match) => match[1])),
  );
  const declared = new Set(
    walk(join(ROOT, 'packages/contract'))
      .filter((file) => file.endsWith('.ts'))
      .flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/^export const (\w+Schema)\b/gm)].map((match) => match[1])),
  );
  const notes = [...declared]
    .filter((name) => !served.has(name))
    .sort()
    .map((name) => ({ check: 'schema-producers', detail: `${name} is in the contract but no /api/v1 route returns it` }));
  return { failures: [], notes };
}

/**
 * Documentation that points a reader at a route which no longer exists.
 *
 * Scoped to the documents that describe the product **as it is now**. `docs/superpowers/plans/` and
 * `specs/` are dated records — a plan written on 2026-09-18 correctly says `overview/audit`, because that
 * is what the segment was called then, and editing it to match today would falsify the record rather than
 * fix anything. Code fences are skipped too, since a path in an example is usually a file, not a URL.
 */
const CURRENT_DOCS = ['docs/README.md', 'docs/mobile/', 'docs/superpowers/audits/', 'README.md', 'AGENTS.md', 'docs/RECOVERY.md'];

function stripFences(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
}

function checkDocRoutes(): CheckResult {
  const failures: Finding[] = [];
  const { subsections } = sections();
  const known = new Set(Object.entries(subsections).flatMap(([section, segments]) => segments.map((segment) => `${section}/${segment}`)));

  for (const file of [...walk(join(ROOT, 'docs')), join(ROOT, 'README.md'), join(ROOT, 'AGENTS.md')]) {
    if (!file.endsWith('.md')) continue;
    const rel = relative(ROOT, file);
    if (!CURRENT_DOCS.some((prefix) => rel.startsWith(prefix))) continue;

    const source = stripFences(readFileSync(file, 'utf8'));
    for (const [, section, segment] of source.matchAll(/\/c\/[^/\s)]+\/[^/\s)]+\/([a-z-]+)\/([a-z-]+)/g)) {
      // A first segment that is not a section means the path is a resource, not a sub-page.
      if (!(section in subsections)) continue;
      if (!known.has(`${section}/${segment}`)) {
        failures.push({ check: 'doc-routes', detail: `${rel} sends a reader to /${section}/${segment}, which is not in the section catalogue` });
      }
    }
  }
  return { failures, notes: [] };
}

/**
 * Every integration the catalogue offers has somewhere to configure it, and every stored credential is
 * read behind the store's one named accessor.
 *
 * Two structural facts with one right answer each. A card saying "Connect Cloudflare" that links to a page
 * nobody built is the menu failure again, in the one place where a user is being asked to paste a secret.
 * And a second path to a ciphertext is how a credential ends up rendered: the store keeps exactly one, and
 * its name is what makes "who can read a credential" a search for a single identifier.
 */
function checkIntegrations(): CheckResult {
  const failures: Finding[] = [];
  const notes: Finding[] = [];

  const catalogue = read('src/lib/integrations/catalogue.ts');
  const block = catalogue.slice(catalogue.indexOf('INTEGRATION_SPECS'), catalogue.length);
  const specs = [...block.matchAll(/(\w[\w-]*):\s*\{\s*id:\s*'([a-z]+)',\s*href:\s*'([^']+)',\s*credentials:\s*'([a-z-]+)'/g)];
  if (specs.length === 0) failures.push({ check: 'integrations', detail: 'INTEGRATION_SPECS could not be parsed, so nothing about it was checked' });

  for (const [, , id, href, credentials] of specs) {
    // `/accounts` and the rest are pages under the app group; a settings page is a directory with a page.
    const page = join(ROOT, 'src/app/[locale]/(app)', href.replace(/^\//, ''), 'page.tsx');
    const available = block.slice(block.indexOf(`id: '${id}'`)).match(/available:\s*(true|false)/)?.[1] === 'true';

    // An integration the card offers a link to must have somewhere to land. One declared unavailable must
    // not — a card that says "not available in this build" and links anyway is the same broken promise.
    if (available && !existsSync(page)) {
      failures.push({ check: 'integrations', detail: `${id} is declared available and points at ${href}, which has no page: the card offers a link that answers 404` });
    }
    if (!available && existsSync(page)) {
      failures.push({ check: 'integrations', detail: `${id} is declared unavailable but ${href} exists: the card hides a page an operator could use` });
    }
    if (credentials === 'stored') {
      notes.push({ check: 'integrations', detail: `${id} keeps a credential in the database, so it must be encrypted and removable from ${href}` });
    }
  }

  // One accessor for a stored credential, and one for an AWS secret. A second would be a second way to leak.
  const store = read('src/lib/store/repositories.ts');
  if (!store.includes('export function credentialFor')) {
    failures.push({ check: 'integrations', detail: 'the store no longer exposes credentialFor: the single named accessor for an integration credential is gone' });
  }
  for (const file of walk(join(ROOT, 'src'))) {
    const rel = relative(ROOT, file);
    if (rel.endsWith('store/repositories.ts')) continue;
    const source = readFileSync(file, 'utf8');
    // Reading it is what is forbidden. Writing one is how a credential is saved, and the field name appears
    // in that input literal — so member access is the signal, not the identifier.
    if (/\.\s*credentialCiphertext/.test(source) && !rel.startsWith('src/lib/db/')) {
      failures.push({ check: 'integrations', detail: `${rel} reads .credentialCiphertext outside the store, which is a second path to a stored secret` });
    }
  }

  return { failures, notes };
}

export function runChecks(): CheckResult {
  const results = [checkSections(), checkFilters(), checkCapabilities(), checkMarkers(), checkSchemaProducers(), checkDocRoutes(), checkIntegrations()];
  return {
    failures: results.flatMap((result) => result.failures),
    notes: results.flatMap((result) => result.notes),
  };
}

/** What only a person can decide. Printed every run so a green check is never mistaken for "the product is done". */
export const HUMAN_ACCEPTANCE = [
  'Does each page tell the truth when it has no data — "not measured" rather than a zero (§2.4, §2.6)?',
  'Can an operator complete the journey the page exists for, not merely load it?',
  'Is every figure on screen something OpsWatch actually measured, rather than a plausible default?',
  'Does the French copy say the same thing as the English, including the caveats?',
  'Has the surface been opened in a browser, signed in, since it last changed?',
  'Does every integration state what access it asks for, before asking for the credential?',
  'Has each integration been connected against the real provider, or is only its architecture proven?',
];

if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/^.*?(?=scripts)/, ''))) {
  const { failures, notes } = runChecks();
  for (const note of notes) console.log(`note   ${note.check}: ${note.detail}`);
  for (const failure of failures) console.error(`FAIL   ${failure.check}: ${failure.detail}`);
  console.log('');
  console.log('Structural checks:', failures.length === 0 ? 'passed' : `${failures.length} failing`);
  console.log(`Notes: ${notes.length} (statements of fact, not failures)`);
  console.log('');
  console.log('Needs human acceptance — this script cannot decide any of these:');
  for (const question of HUMAN_ACCEPTANCE) console.log(`  - ${question}`);
  process.exit(failures.length === 0 ? 0 : 1);
}
