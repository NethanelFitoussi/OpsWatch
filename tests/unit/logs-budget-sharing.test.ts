import { describe, expect, it } from 'vitest';
import {
  BYTES_PER_GB,
  budgetState,
  readUsage,
  recordBudgetStop,
  recordScan,
  spendingConnections,
  usageBetween,
} from '@/lib/store/logs-budget';
import { upsertLogSource } from '@/lib/store/errors';
import { createConnection } from '@/lib/connections/repository';
import { createTestDb } from '../helpers/db';
import { connectionInput, NOW as FIXTURE_NOW } from '../helpers/fixtures';

/**
 * The Logs Insights budget across several connected AWS accounts (MC-10).
 *
 * The budget used to be keyed by the UTC day alone. Two accounts therefore shared one pot,
 * first-come-first-served: the account whose collection ran first could spend the whole day's cap before
 * the second account had scanned a single byte, every day, and no page said who had spent it. That is the
 * behaviour these tests hold shut.
 */

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
const DAY = 24 * 60 * 60_000;

/** An account that reads logs: a connection with an enabled log source, which is what can spend. */
function account(db: ReturnType<typeof createTestDb>, name: string, enabled = true) {
  const row = createConnection(db, connectionInput({ name }), FIXTURE_NOW);
  upsertLogSource(db, {
    connectionId: row.id,
    scope: 'eu-west-1',
    logGroup: `/aws/ecs/${name}`,
    serviceId: null,
    enabled,
    format: 'json',
    fieldMap: { message: '$.msg' },
  });
  return row.id;
}

describe('one account cannot spend another account’s budget', () => {
  it('THE RULING: a busy account stops at its share, and the quiet account still has all of its own', () => {
    const db = createTestDb();
    const busy = account(db, 'busy');
    const quiet = account(db, 'quiet');

    // The busy account scans the whole installation's cap, as it used to be free to.
    recordScan(db, NOW, busy, 10 * BYTES_PER_GB);

    expect(budgetState(db, NOW, 10, busy).exhausted).toBe(true);
    const other = budgetState(db, NOW, 10, quiet);
    // The quiet account has not spent a byte of its own share, and the day says so rather than
    // recording a stop against it.
    expect(other.bytesScanned).toBe(0);
    expect(other.budgetBytes).toBe(5 * BYTES_PER_GB);
    expect(other.stoppedAt).toBeNull();

    // Which is the whole point: tomorrow it collects. Before the split the busy account reached the
    // shared pot first every single day, so the quiet account's errors were never collected at all.
    const tomorrow = budgetState(db, NOW + DAY, 10, quiet);
    expect(tomorrow.exhausted).toBe(false);
    expect(tomorrow.remainingBytes).toBe(5 * BYTES_PER_GB);
  });

  it('stops a well-behaved account at the installation’s cap rather than letting the bill grow with accounts', () => {
    const db = createTestDb();
    const busy = account(db, 'busy');
    const quiet = account(db, 'quiet');
    recordScan(db, NOW, busy, 10 * BYTES_PER_GB);

    const other = budgetState(db, NOW, 10, quiet);
    expect(other.exhausted).toBe(true);
    // And it says which of the two stops it was, because the remedy differs.
    expect(other.stoppedByInstance).toBe(true);
    expect(other.bytesScanned).toBe(0);
  });

  it('gives each account an equal share, and the whole cap when it is the only one reading logs', () => {
    const db = createTestDb();
    const only = account(db, 'only');
    expect(spendingConnections(db)).toBe(1);
    expect(budgetState(db, NOW, 10, only).budgetBytes).toBe(10 * BYTES_PER_GB);

    account(db, 'second');
    expect(spendingConnections(db)).toBe(2);
    expect(budgetState(db, NOW, 10, only).budgetBytes).toBe(5 * BYTES_PER_GB);
  });

  it('does not hold a share back for an account that reads no logs', () => {
    const db = createTestDb();
    const reader = account(db, 'reader');
    account(db, 'watcher', false); // connected, but no log source switched on: it cannot spend.
    expect(spendingConnections(db)).toBe(1);
    expect(budgetState(db, NOW, 10, reader).budgetBytes).toBe(10 * BYTES_PER_GB);
  });

  it('never divides by zero on an installation that collects no errors at all', () => {
    const db = createTestDb();
    expect(spendingConnections(db)).toBe(1);
    expect(budgetState(db, NOW, 10, 'nobody').budgetBytes).toBe(10 * BYTES_PER_GB);
  });

  it('counts each account’s spend separately, and reports each account its own', () => {
    const db = createTestDb();
    const a = account(db, 'a');
    const b = account(db, 'b');
    recordScan(db, NOW, a, 3 * BYTES_PER_GB);
    recordScan(db, NOW, b, BYTES_PER_GB);

    expect(readUsage(db, NOW, a).bytesScanned).toBe(3 * BYTES_PER_GB);
    expect(readUsage(db, NOW, b).bytesScanned).toBe(BYTES_PER_GB);
    expect(budgetState(db, NOW, 10, a).instanceBytesScanned).toBe(4 * BYTES_PER_GB);

    const window = { from: NOW - DAY, to: NOW + DAY };
    expect(usageBetween(db, a, window).bytesScanned).toBe(3 * BYTES_PER_GB);
    expect(usageBetween(db, b, window).queries).toBe(1);
  });

  it('records the stop against the account it stopped, not against the day', () => {
    const db = createTestDb();
    const a = account(db, 'a');
    const b = account(db, 'b');
    recordBudgetStop(db, NOW, a);

    expect(budgetState(db, NOW, 10, a).stoppedAt).toBe(NOW);
    expect(budgetState(db, NOW, 10, b).stoppedAt).toBeNull();
    const window = { from: NOW - DAY, to: NOW + DAY };
    expect(usageBetween(db, a, window).stoppedDays).toBe(1);
    expect(usageBetween(db, b, window).stoppedDays).toBe(0);
  });
});
