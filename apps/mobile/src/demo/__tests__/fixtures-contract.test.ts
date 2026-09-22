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
