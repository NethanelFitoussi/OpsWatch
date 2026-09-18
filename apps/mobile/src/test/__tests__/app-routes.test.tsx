import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderRouter, screen } from 'expo-router/testing-library';
import { seedDemoSession } from '../render';

jest.setTimeout(20_000);

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('shows Connect when no server is configured', async () => {
  renderRouter('./app', { initialUrl: '/' });
  expect(await screen.findByTestId('connect-screen')).toBeTruthy();
});

it('opens Home on the demo server and answers "is production healthy?"', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/' });
  expect(await screen.findByTestId('status-title', {}, { timeout: 5000 })).toHaveTextContent('Degraded');
  expect(screen.getByTestId('action-verdict')).toHaveTextContent('Yes: 2 critical problem(s) are open.');
  expect(screen.getByTestId('demo-banner')).toBeTruthy();
});
