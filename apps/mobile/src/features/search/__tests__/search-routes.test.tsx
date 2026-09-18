import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { PREF_KEYS } from '@/state/storage';
import { seedDemoSession } from '@/test/render';

jest.setTimeout(20_000);

beforeEach(async () => {
  await AsyncStorage.clear();
});

async function storedRecentSearches(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(PREF_KEYS.settings);
  return raw ? ((JSON.parse(raw) as { recentSearches?: string[] }).recentSearches ?? []) : [];
}

it('groups results for "checkout" and records a recent search when one is opened', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/search' });
  fireEvent.changeText(await screen.findByTestId('search-input', {}, { timeout: 5000 }), 'checkout');

  expect(await screen.findByTestId('search-group-problem', {}, { timeout: 5000 })).toBeTruthy();
  expect(screen.getByTestId('search-group-service')).toBeTruthy();
  expect(screen.getByTestId('search-ask-ai')).toHaveTextContent(/Ask OpsWatch: checkout/);

  fireEvent.press(screen.getByTestId('search-result-problem-prb-checkout-5xx'));
  await waitFor(async () => expect(await storedRecentSearches()).toEqual(['checkout']));
});

it('shows no results and clears recent searches', async () => {
  await seedDemoSession();
  await AsyncStorage.setItem(PREF_KEYS.settings, JSON.stringify({ recentSearches: ['redis'] }));
  renderRouter('./app', { initialUrl: '/search' });
  expect(await screen.findByTestId('search-recent-0', {}, { timeout: 5000 })).toHaveTextContent(/redis/);
  fireEvent.press(screen.getByTestId('search-clear-recent'));
  expect(screen.queryByTestId('search-recent-0')).toBeNull();

  fireEvent.changeText(screen.getByTestId('search-input'), 'zzzz-nothing');
  expect(await screen.findByText('No results', {}, { timeout: 5000 })).toBeTruthy();
});
