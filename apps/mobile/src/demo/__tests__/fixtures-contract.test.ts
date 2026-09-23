/**
 * The demo dataset is what contributors see and what the mock server serves, so it must be valid against the contract
 * and serialisable exactly like a real server response.
 */
import {
  alertDetailSchema,
  briefSchema,
  deploymentDetailSchema,
  environmentSchema,
  errorDetailSchema,
  healthSchema,
  incidentDetailSchema,
  infraDetailSchema,
  investigationSchema,
  logEntrySchema,
  problemDetailSchema,
  repositoryEvidenceSchema,
  serverInfoSchema,
  serviceDetailSchema,
  sloDetailSchema,
  syntheticDetailSchema,
} from '@/api/contract';
import * as engine from '../engine';
import { buildDemoDataset, calmHealth } from '../fixtures';

const data = buildDemoDataset(1_750_000_000_000);
const roundTrip = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

it('serialises without reference cycles', () => {
  expect(() => JSON.stringify(data)).not.toThrow();
});

it.each([
  ['server', serverInfoSchema, [data.server]],
  ['environments', environmentSchema, data.environments],
  ['health', healthSchema, [data.health, calmHealth(1_750_000_000_000)]],
  ['brief', briefSchema, [data.brief]],
  ['problems', problemDetailSchema, data.problems],
  ['errors', errorDetailSchema, data.errors],
  ['services', serviceDetailSchema, data.services],
  ['infrastructure', infraDetailSchema, data.infrastructure],
  ['logs', logEntrySchema, data.logs],
  ['alerts', alertDetailSchema, data.alerts],
  ['incidents', incidentDetailSchema, data.incidents],
  ['synthetics', syntheticDetailSchema, data.synthetics],
  ['slos', sloDetailSchema, data.slos],
  ['deployments', deploymentDetailSchema, data.deployments],
  ['investigations', investigationSchema, data.investigations],
  ['repository', repositoryEvidenceSchema, data.repository],
] as const)('%s match the contract after JSON round trip', (_name, schema, items) => {
  for (const item of items) {
    const parsed = (schema as { safeParse: (v: unknown) => { success: boolean; error?: { issues: unknown[] } } }).safeParse(roundTrip(item));
    expect(parsed.error?.issues ?? []).toEqual([]);
  }
});

it('references only objects that exist', () => {
  const ids = new Set<string>([
    ...data.problems.map((p) => p.id),
    ...data.errors.map((e) => e.id),
    ...data.services.map((s) => s.id),
    ...data.infrastructure.map((r) => r.id),
    ...data.alerts.map((a) => a.id),
    ...data.incidents.map((i) => i.id),
    ...data.synthetics.map((s) => s.id),
    ...data.deployments.map((d) => d.id),
    ...data.investigations.map((i) => i.id),
    ...data.repository.map((r) => r.id),
  ]);
  const refs: string[] = [];
  JSON.stringify(data, (key, value: unknown) => {
    if (key === 'ref' && value && typeof value === 'object' && 'id' in value) refs.push((value as { id: string }).id);
    return value;
  });
  expect(refs.filter((id) => !ids.has(id))).toEqual([]);
});

/**
 * A search reports what it searched.
 *
 * The demo used to answer "0 matched, 240 scanned" for an environment holding no logs — a confident claim that a
 * thorough search found nothing, when nothing was searched. The mock server serves this engine, so the lie reached
 * anyone developing against it, and it is the precise shape of dishonest statistic the app exists to avoid.
 */
it('never claims to have scanned records it did not search', () => {
  const now = 1_750_000_000_000;
  const dataset = buildDemoDataset(now);
  const window = { from: now - 24 * 3_600_000, to: now };

  const staging = engine.searchLogs(dataset, 'staging-eu-west-1', { ...window, levels: [] }).statistics;
  expect(staging?.recordsMatched).toBe(0);
  expect(staging?.recordsScanned).toBe(0);

  const production = engine.searchLogs(dataset, 'prod-eu-west-1', { ...window, levels: [] }).statistics;
  expect(production?.recordsScanned).toBeGreaterThan(0);
  expect(production?.recordsMatched).toBeLessThanOrEqual(production!.recordsScanned!);
});
