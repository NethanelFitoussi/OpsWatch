/**
 * Parity between this app's local contract copy and the canonical `packages/contract`.
 *
 * - Every schema the app uses must exist in the package under the same name.
 * - Every demo fixture (what the mock server serves) must parse identically with both.
 * Skipped while the package is not on this branch. To check against a work in progress elsewhere:
 *   OPSWATCH_CONTRACT_DIR=/path/to/packages/contract npx jest contract-parity
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as local from '../contract';
import { buildDemoDataset } from '@/demo/fixtures';

const dir = process.env.OPSWATCH_CONTRACT_DIR ?? resolve(__dirname, '../../../../../packages/contract');
const available = existsSync(resolve(dir, 'index.ts'));
const suite = available ? describe : describe.skip;

type Schema = { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: { issues: { path: PropertyKey[]; message: string }[] } } };

suite('packages/contract parity', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const canonical = (available ? require(resolve(dir, 'index.ts')) : {}) as Record<string, unknown>;
  const data = JSON.parse(JSON.stringify(buildDemoDataset(1_750_000_000_000))) as ReturnType<typeof buildDemoDataset>;

  const localSchemas = Object.entries(local).filter(([name, value]) => name.endsWith('Schema') && typeof (value as Schema)?.safeParse === 'function');

  it.each(localSchemas.map(([name]) => name))('exports %s', (name) => {
    expect(typeof (canonical[name] as Schema | undefined)?.safeParse).toBe('function');
  });

  it('keeps the same API prefix and version', () => {
    expect(canonical.API_PREFIX).toBe(local.API_PREFIX);
    expect(canonical.API_VERSION).toBe(local.API_VERSION);
  });

  const cases: [string, unknown[]][] = [
    ['serverInfoSchema', [data.server]],
    ['environmentSchema', data.environments],
    ['healthSchema', [data.health]],
    ['briefSchema', [data.brief]],
    ['problemDetailSchema', data.problems],
    ['errorDetailSchema', data.errors],
    ['serviceDetailSchema', data.services],
    ['infraDetailSchema', data.infrastructure],
    ['logEntrySchema', data.logs.slice(0, 20)],
    ['alertDetailSchema', data.alerts],
    ['incidentDetailSchema', data.incidents],
    ['syntheticDetailSchema', data.synthetics],
    ['sloDetailSchema', data.slos],
    ['deploymentDetailSchema', data.deployments],
    ['investigationSchema', data.investigations],
    ['repositoryEvidenceSchema', data.repository],
  ];

  // The package may add optional fields (additive changes only inside v1), so it must parse to a superset.
  it.each(cases)('%s parses the demo data like the local copy', (name, items) => {
    const theirs = canonical[name] as Schema;
    const ours = (local as unknown as Record<string, Schema>)[name]!;
    for (const item of items) {
      const a = theirs.safeParse(item);
      const b = ours.safeParse(item);
      expect(a.error?.issues.map((i) => `${i.path.join('.')}: ${i.message}`) ?? []).toEqual([]);
      expect(a.data).toMatchObject(b.data as object);
    }
  });
});
