/**
 * System status against a server that is not behaving.
 *
 * Every string on this screen comes from the server, and three of them — the job name, its error code and the
 * collector's host — are free text the contract does not constrain. A compromised or simply buggy server can put
 * anything there, and this is the page someone opens *because* they already suspect something is wrong, so it has to
 * stay readable when its own input is hostile.
 */
import { screen } from '@testing-library/react-native';
import type { SystemStatus } from '@/api/contract';
import { shouldPersistQuery } from '@/api/query-provider';
import { keys } from '@/api/queries';
import { renderWithProviders } from '@/test/render';
import { About, CollectorVerdict, Jobs } from '../components';
import { label, MAX_SERVER_LABEL } from '../helpers';

const NOW = 1_800_000_000_000;

const status = (over: Partial<SystemStatus> = {}): SystemStatus => ({
  version: '1.0.0',
  generatedAt: NOW,
  collector: { owner: 'host-1', heartbeatAt: NOW - 1000, alive: true, neverRan: false },
  jobs: [],
  environments: [],
  database: { sizeBytes: 1000, schemaVersion: 6 },
  ...over,
});

it('truncates a job name, error code and host long enough to push the screen apart', async () => {
  const huge = 'A'.repeat(5_000);
  await renderWithProviders(
    <>
      <CollectorVerdict status={status({ collector: { owner: huge, heartbeatAt: NOW, alive: true, neverRan: false } })} />
      <Jobs
        jobs={[
          {
            job: huge,
            everyMs: 60_000,
            lastRunAt: NOW - 1000,
            lastStatus: 'failed',
            durationMs: 10,
            covered: null,
            total: null,
            truncated: false,
            errorCode: huge,
            nextRunAt: NOW + 60_000,
          },
        ]}
      />
    </>,
  );

  // Nowhere in the tree — not the visible text, not a testID, and above all not an accessibility label, which a
  // screen reader would otherwise read out in full.
  const rendered = JSON.stringify(screen.toJSON());
  expect(rendered).not.toContain('A'.repeat(MAX_SERVER_LABEL + 10));
  expect(label(huge).length).toBeLessThanOrEqual(MAX_SERVER_LABEL + 1);
  expect(label(huge).endsWith('…')).toBe(true);
});

it('leaves an ordinary label exactly as the server sent it', () => {
  expect(label('inventory')).toBe('inventory');
  expect(label('ThrottlingException')).toBe('ThrottlingException');
});

/**
 * System status names the collector's host and every job an instance runs — an operational inventory. It is read on
 * a phone that may be lost, so it must stay in memory: only glanceable *lists* are written to the offline cache, and
 * this is a detail query precisely so it is not one.
 */
it('is never written to the offline cache', () => {
  const persisted = shouldPersistQuery({
    queryKey: [...keys.systemStatus()],
    state: { status: 'success', dataUpdatedAt: Date.now() } as never,
  });
  expect(persisted).toBe(false);
});

it('renders a database size it was not given as unknown rather than as zero', async () => {
  await renderWithProviders(<About status={status({ database: { sizeBytes: null, schemaVersion: null } })} />);
  const about = screen.getByTestId('system-about');
  expect(about).toHaveTextContent(/—/);
  expect(about).not.toHaveTextContent(/\b0 (B|bytes)\b/);
});
