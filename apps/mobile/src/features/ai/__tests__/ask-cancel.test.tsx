/**
 * An AI answer can take up to a minute, so waiting for one is abandonable: the request is really cancelled (not just
 * hidden), the screen says so, and asking again works.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { createDemoClient } from '@/demo/demo-client';
import { seedDemoSession } from '@/test/render';

jest.setTimeout(20_000);

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('rejects an abandoned request instead of answering later', async () => {
  const client = createDemoClient({ latencyMs: 50 });
  const controller = new AbortController();
  const answer = client.ask({}, 'Why is production unhealthy?', undefined, controller.signal);
  controller.abort();
  await expect(answer).rejects.toMatchObject({ kind: 'cancelled' });

  // An already-aborted signal is refused without waiting at all.
  await expect(client.ask({}, 'again', undefined, AbortSignal.abort())).rejects.toMatchObject({ kind: 'cancelled' });
});

it('shows that the answer was abandoned, and asks again on request', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/ask' });

  fireEvent.press(await screen.findByTestId('ask-suggestion-unhealthy', {}, { timeout: 5000 }));
  await screen.findByTestId('ask-pending');
  fireEvent.press(screen.getByTestId('ask-cancel'));

  expect(await screen.findByTestId('ask-cancelled')).toBeTruthy();
  expect(screen.queryByTestId('ask-pending')).toBeNull();
  expect(screen.queryByTestId('ai-generated')).toBeNull();

  fireEvent.press(screen.getByTestId('ask-again'));
  expect(await screen.findByTestId('ai-generated', {}, { timeout: 8000 })).toBeTruthy();
});
