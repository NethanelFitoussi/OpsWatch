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
