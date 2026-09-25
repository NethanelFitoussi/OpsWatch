import { describe, expect, it } from 'vitest';
import {
  LOG_FORMATS,
  MAPPABLE_FIELDS,
  SOURCE_PRESETS,
  isUsableMap,
  presetById,
  presetOf,
} from '@/lib/errors/source-presets';
import { readSources, saveSource } from '@/lib/read/log-sources';
import { parseLine } from '@/lib/detect/log-parse';
import { enabledLogSources } from '@/lib/store/errors';
import { recordScan } from '@/lib/store/logs-budget';
import { createTestDb } from '../helpers/db';

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
const env = { connectionId: 'c1', scope: 'us-east-1' };
const context = { nowMs: NOW, budgetGbPerDay: 5 };

describe('the presets an operator chooses from', () => {
  it('each names a format the parser understands and a path to the message', () => {
    for (const preset of SOURCE_PRESETS) {
      expect(LOG_FORMATS).toContain(preset.format);
      // A preset that cannot find a message would configure a source that reads nothing.
      expect(isUsableMap(preset.fields)).toBe(true);
    }
  });

  it('THE RULING: a preset actually parses the shape it claims to', () => {
    const json = presetById('json');
    const line = JSON.stringify({
      level: 'error',
      path: '/checkout',
      err: { type: 'TypeError', message: 'boom', stack: 'TypeError: boom\n    at pay (/app/pay.ts:1:1)' },
    });
    const parsed = parseLine(line, json?.format ?? 'json', json?.fields ?? {});
    expect(parsed).toMatchObject({ level: 'error', type: 'TypeError', message: 'boom', route: '/checkout' });
    expect(parsed.stack).toContain('at pay');
  });

  it('the API preset parses the other shape, and the two do not both fit one line', () => {
    const api = presetById('api');
    const line = JSON.stringify({ level: 'warn', route: '/pay', error: { name: 'RangeError', message: 'nope' } });
    expect(parseLine(line, api?.format ?? 'json', api?.fields ?? {})).toMatchObject({
      type: 'RangeError',
      message: 'nope',
      route: '/pay',
    });
    // The JSON preset looks in `err`, which this line does not have: no message rather than a wrong one.
    expect(parseLine(line, 'json', presetById('json')?.fields ?? {}).message).toBeNull();
  });

  it('the plain preset takes the whole line as the message', () => {
    const plain = presetById('plain');
    expect(parseLine('something broke', plain?.format ?? 'regex', plain?.fields ?? {}).message).toBe('something broke');
  });

  it('recognises a stored map as the preset it came from, and a changed one as custom', () => {
    const json = presetById('json');
    expect(presetOf('json', json?.fields ?? {})).toBe('json');
    expect(presetOf('json', { ...json?.fields, message: '$.msg' })).toBe('custom');
    // A different format with the same paths is not the same preset.
    expect(presetOf('regex', json?.fields ?? {})).toBe('custom');
  });

  it('names every field the fingerprint and the endpoint query need', () => {
    expect([...MAPPABLE_FIELDS]).toEqual(['level', 'type', 'message', 'stack', 'route']);
  });

  it('refuses a map with no message path, because nothing could be read from it', () => {
    expect(isUsableMap({})).toBe(false);
    expect(isUsableMap({ message: '   ' })).toBe(false);
    expect(isUsableMap({ message: '$.msg' })).toBe(true);
  });
});

describe('what the page reads', () => {
  it('a fresh environment has no sources, which is not the same as no log groups', () => {
    const view = readSources(createTestDb(), env, context);
    expect(view.sources).toEqual([]);
    expect(view.enabled).toBe(0);
  });

  it('states the budget, what is left of it, and whether it is spent', () => {
    const db = createTestDb();
    const view = readSources(db, env, context);
    expect(view.budget).toMatchObject({ limitGb: 5, exhausted: false });
    expect(view.budget.remainingGb).toBeCloseTo(5, 6);

    recordScan(db, NOW, env.connectionId, 5 * 1024 ** 3);
    const spent = readSources(db, env, context);
    expect(spent.budget.exhausted).toBe(true);
    expect(spent.budget.scannedGb).toBeCloseTo(5, 6);
  });

  it('lists a disabled source too, because one that costs nothing still needs switching on', () => {
    const db = createTestDb();
    saveSource(db, { ...env, logGroup: '/a', serviceId: null, enabled: false, format: 'json', fields: { message: '$.m' } }, NOW);
    const view = readSources(db, env, context);
    expect(view.sources).toHaveLength(1);
    expect(view.enabled).toBe(0);
    expect(enabledLogSources(db, env.connectionId, env.scope)).toEqual([]);
  });
});

describe('saving a source', () => {
  it('stores the paths and nothing else', () => {
    const db = createTestDb();
    const saved = saveSource(
      db,
      { ...env, logGroup: '/aws/ecs/web', serviceId: 'prod/web', enabled: true, format: 'json', fields: { message: '$.err.message' } },
      NOW,
    );
    expect(saved.fields).toEqual({ message: '$.err.message' });
    // The stored row carries a map of paths; no log line ever reaches the database.
    expect(JSON.stringify(saved)).not.toContain('boom');
  });

  it('THE RULING: saving the same group twice edits it rather than adding a second row', () => {
    const db = createTestDb();
    const input = { ...env, logGroup: '/aws/ecs/web', serviceId: null, enabled: false, format: 'json' as const, fields: { message: '$.m' } };
    saveSource(db, input, NOW);
    saveSource(db, { ...input, enabled: true }, NOW);

    const view = readSources(db, env, context);
    expect(view.sources).toHaveLength(1);
    expect(view.sources[0]?.enabled).toBe(true);
  });

  it('keeps two different groups apart', () => {
    const db = createTestDb();
    const base = { ...env, serviceId: null, enabled: true, format: 'json' as const, fields: { message: '$.m' } };
    saveSource(db, { ...base, logGroup: '/a' }, NOW);
    saveSource(db, { ...base, logGroup: '/b' }, NOW);
    expect(readSources(db, env, context).enabled).toBe(2);
  });

  it('reports which preset a saved source matches, so the form shows what was chosen', () => {
    const db = createTestDb();
    const json = presetById('json');
    saveSource(db, { ...env, logGroup: '/a', serviceId: null, enabled: false, format: 'json', fields: json?.fields ?? {} }, NOW);
    expect(readSources(db, env, context).sources[0]?.preset).toBe('json');
  });
});
