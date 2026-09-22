import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { buildDemoDataset, DEMO_CREDENTIALS } from '@/demo/fixtures';
import { DEMO_SERVER_URL } from '@/state/session';
import { PREF_KEYS } from '@/state/storage';
import { seedDemoSession } from '@/test/render';

jest.setTimeout(20_000);

beforeEach(async () => {
  await AsyncStorage.clear();
});

/** Like seedDemoSession, but the server advertises no AI. */
async function seedDemoSessionWithoutAi(): Promise<void> {
  const server = buildDemoDataset().server;
  await AsyncStorage.setItem(
    PREF_KEYS.server,
    JSON.stringify({ url: DEMO_SERVER_URL, demo: true, insecure: false, info: { ...server, features: { ...server.features, ai: false } }, user: { email: DEMO_CREDENTIALS.email } }),
  );
}

it('answers a suggested question with citations and the AI-generated label', async () => {
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/ask' });
  fireEvent.press(await screen.findByTestId('ask-suggestion-unhealthy', {}, { timeout: 5000 }));
  expect(await screen.findByTestId('ask-pending')).toBeTruthy();
  expect(await screen.findByTestId('ai-generated', {}, { timeout: 5000 })).toHaveTextContent(/AI-generated\. Check the cited evidence before acting\./);
  expect(screen.getByTestId('ask-citation-problem-prb-checkout-5xx')).toHaveTextContent(/Problem prb-checkout-5xx/);
  expect(screen.getByText('Model: demo (canned answers)')).toBeTruthy();
  expect(screen.getByText('Why is production unhealthy?')).toBeTruthy();
});

// External links drop query strings (deep-link allow-list), so contextual asks are opened in-app, as AskAiButton does.
async function openAsk(params: Record<string, string>) {
  renderRouter('./app', { initialUrl: '/ask' });
  await screen.findByTestId('ask-input', {}, { timeout: 5000 });
  act(() => router.push({ pathname: '/ask', params }));
}

it('shows the removable context chip and the prefilled question', async () => {
  await seedDemoSession();
  await openAsk({ contextType: 'problem', contextId: 'prb-checkout-5xx', question: 'Why is this happening?' });
  expect(await screen.findByTestId('ask-context', {}, { timeout: 5000 })).toHaveTextContent(/About: Problem prb-checkout-5xx/);
  expect(screen.getByTestId('ask-input').props.value).toBe('Why is this happening?');
  expect(screen.getByTestId('ask-counter')).toHaveTextContent(/22\/500/);
  fireEvent.press(screen.getByTestId('ask-context-remove'));
  expect(screen.queryByTestId('ask-context')).toBeNull();
});

it('ignores an invalid context', async () => {
  await seedDemoSession();
  await openAsk({ contextType: 'user', contextId: 'prb-checkout-5xx' });
  expect(await screen.findByTestId('ask-input', {}, { timeout: 5000 })).toBeTruthy();
  expect(screen.queryByTestId('ask-context')).toBeNull();
});

it('explains that AI is optional when the server has none', async () => {
  await seedDemoSessionWithoutAi();
  renderRouter('./app', { initialUrl: '/ask' });
  expect(await screen.findByTestId('ask-disabled', {}, { timeout: 5000 })).toBeTruthy();
  expect(screen.getByText('Ask OpsWatch is optional')).toBeTruthy();
  expect(screen.getByText(/never holds AI provider keys/)).toBeTruthy();
  expect(screen.getByText(/Everything else works without it/)).toBeTruthy();
  expect(screen.queryByTestId('ask-input')).toBeNull();
});
