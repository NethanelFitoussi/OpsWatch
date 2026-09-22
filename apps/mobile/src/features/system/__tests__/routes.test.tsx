/**
 * The System status screen, driven through the real router against the demo server.
 *
 * Reached the way a person reaches it — More → System status — rather than by handing the router an initial URL,
 * so the test also covers the entry being discoverable. Whether a *link* to it is allowed is a separate question,
 * asserted in the deep-link tests.
 *
 * The demo deliberately contains the two job states that are easiest to render wrongly — one that ran and failed,
 * and one that has never run — so the screen's worst case is exercised by simply opening it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { seedDemoSession } from '@/test/render';

jest.setTimeout(20_000);

beforeEach(async () => {
  await AsyncStorage.clear();
});

/** More → System status, returning once the screen is on. */
async function openSystem() {
  const app = renderRouter('./app', { initialUrl: '/' });
  await screen.findByTestId('status-title', {}, { timeout: 5000 });
  fireEvent.press(screen.getByTestId('tab-more'));
  fireEvent.press(await screen.findByTestId('more-system', {}, { timeout: 5000 }));
  await waitFor(() => expect(app.getPathname()).toBe('/system'), { timeout: 5000 });
  return app;
}

it('answers whether OpsWatch is collecting, and what that means for the other screens', async () => {
  await seedDemoSession();
  await openSystem();

  expect(await screen.findByTestId('system-verdict', {}, { timeout: 5000 })).toBeTruthy();
  // The demo has a failing errors job, so the verdict is "collecting, with failures" rather than a clean pass.
  expect(screen.getByTestId('system-verdict-badge')).toHaveTextContent(/Collecting, with failures/);
  expect(screen.getByTestId('system-consequence')).toHaveTextContent(/failing jobs.*out of date/);
});

it('separates a job that failed from one that has never run', async () => {
  await seedDemoSession();
  await openSystem();

  expect(await screen.findByTestId('system-jobs', {}, { timeout: 5000 })).toBeTruthy();
  expect(screen.getByTestId('system-job-state-errors')).toHaveTextContent(/Failed/);
  expect(screen.getByTestId('system-job-state-compaction')).toHaveTextContent(/Never run/);
  // A failure names its cause, and a truncated run says it was incomplete rather than showing a smaller number.
  expect(screen.getByTestId('system-job-error-errors')).toHaveTextContent(/ThrottlingException/);
  expect(screen.getByTestId('system-job-partial-errors')).toHaveTextContent(/incomplete/);
});

it('shows which environments were read completely and which were not', async () => {
  await seedDemoSession();
  await openSystem();

  const environments = await screen.findByTestId('system-environments', {}, { timeout: 5000 });
  expect(environments).toHaveTextContent(/Everything read/);
  expect(environments).toHaveTextContent(/4 of 6/);
});

it('reports the instance itself without inventing what it was not told', async () => {
  await seedDemoSession();
  await openSystem();

  const about = await screen.findByTestId('system-about', {}, { timeout: 5000 });
  expect(about).toHaveTextContent(/0\.1\.0-demo/);
  expect(about).toHaveTextContent(/MB|KB/);
});
