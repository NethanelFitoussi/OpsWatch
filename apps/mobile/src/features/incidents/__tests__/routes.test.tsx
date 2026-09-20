import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderRouter, screen } from 'expo-router/testing-library';
import { seedDemoSession } from '@/test/render';

jest.setTimeout(20_000);

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('lists incidents with status and duration', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/incidents' });
  const ongoing = await screen.findByTestId('incident-row-inc-2291', {}, { timeout: 5000 });
  expect(ongoing).toHaveTextContent(/Investigating · for 40 min/);
  expect(screen.getByTestId('incident-row-inc-2288')).toHaveTextContent(/Resolved · lasted 15 min/);
});

it('shows the timeline and related problems of inc-2291', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/incidents/inc-2291' });
  const timeline = await screen.findByTestId('incident-timeline', {}, { timeout: 5000 });
  expect(timeline).toHaveTextContent(/Incident opened from alarm checkout-5xx-high/);
  expect(timeline).toHaveTextContent(/Status changed to investigating/);
  expect(screen.getByTestId('problem-prb-checkout-5xx')).toBeTruthy();
  expect(screen.getByTestId('problem-prb-aurora-connections')).toBeTruthy();
  expect(screen.getByTestId('incident-status')).toHaveTextContent(/Investigating/);
  expect(screen.getByTestId('ask-ai')).toBeTruthy();
});

it('shows a resolved incident with its total duration, dated timeline entries and no empty sections', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/incidents/inc-2288' });
  expect(await screen.findByTestId('incident-duration', {}, { timeout: 5000 })).toHaveTextContent('lasted 15 min');
  // It started more than a day ago: a bare "22:41" would read as an hour ago, so the entries carry their date.
  expect(screen.getByTestId('incident-timeline-0')).toHaveTextContent(/[A-Za-z]{3} \d{1,2},/);
  expect(screen.getByTestId('incident-screen')).toHaveTextContent(/Rollout completed after a task failed its first health check/);
  expect(screen.queryByTestId('incident-notes')).toBeNull();
});

it('marks each incident row with its state, so a resolved one cannot be read as ongoing', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/incidents' });
  expect(await screen.findByTestId('incident-row-status-inc-2291', {}, { timeout: 5000 })).toHaveTextContent(/Investigating/);
  expect(screen.getByTestId('incident-row-status-inc-2288')).toHaveTextContent(/Resolved/);
});
