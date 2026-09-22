/**
 * Demo capability switches let a contributor see the app degrade exactly as it would against a server without those
 * capabilities — and must never touch a real server's advertised features.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { buildDemoDataset } from '@/demo/fixtures';
import { withDemoCapabilities, type SessionState } from '@/state/session';
import { seedDemoSession } from '@/test/render';

jest.setTimeout(20_000);

const info = buildDemoDataset(1_750_000_000_000).server;
const signedIn = (demo: boolean): SessionState => ({
  status: 'signed-in',
  server: { url: demo ? 'demo://opswatch' : 'https://ops.example.com', demo, insecure: false, info },
  user: { email: 'demo@opswatch.dev' },
});

describe('withDemoCapabilities', () => {
  it('switches off only what was asked, and only in demo mode', () => {
    const demoed = withDemoCapabilities(signedIn(true), { ai: false });
    expect(demoed.status === 'signed-in' && demoed.server.info?.features.ai).toBe(false);
    expect(demoed.status === 'signed-in' && demoed.server.info?.features.problems).toBe(true);

    const real = withDemoCapabilities(signedIn(false), { ai: false });
    expect(real.status === 'signed-in' && real.server.info?.features.ai).toBe(true);
  });

  it('cannot switch a capability on that the server does not have', () => {
    // push is false in the demo server info; asking for true must not invent it.
    const demoed = withDemoCapabilities(signedIn(true), { push: true });
    expect(demoed.status === 'signed-in' && demoed.server.info?.features.push).toBe(false);
  });

  it('leaves the state untouched when nothing is switched off', () => {
    const state = signedIn(true);
    expect(withDemoCapabilities(state, {})).toBe(state);
  });
});

it('switching AI off in demo makes Ask OpsWatch show the optional-feature state', async () => {
  await AsyncStorage.clear();
  await seedDemoSession();
  renderRouter('./app', { initialUrl: '/settings' });

  fireEvent(await screen.findByTestId('demo-capability-ai', {}, { timeout: 5000 }), 'valueChange', false);
  expect(await screen.findByTestId('demo-reset')).toBeTruthy();

  renderRouter('./app', { initialUrl: '/ask' });
  expect(await screen.findByTestId('ask-disabled', {}, { timeout: 5000 })).toBeTruthy();
});
