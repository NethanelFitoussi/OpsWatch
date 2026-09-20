import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { seedDemoSession } from '@/test/render';

jest.setTimeout(20_000);

beforeEach(async () => {
  await AsyncStorage.clear();
  await seedDemoSession();
});

const wait = { timeout: 5000 };

it('renders the investigation as one tagged timeline, and by kind on demand', async () => {
  renderRouter('./app', { initialUrl: '/investigations/inv-checkout-5xx' });
  const timeline = await screen.findByTestId('investigation-timeline', {}, wait);
  expect(timeline).toHaveTextContent(/checkout-api v2\.14\.0 deployed/);
  expect(timeline).toHaveTextContent(/Fact/);
  expect(timeline).toHaveTextContent(/Correlation/);
  expect(timeline).toHaveTextContent(/Hypothesis/);
  expect(screen.getByTestId('investigation-title')).toHaveTextContent('Checkout 5xx and database connection saturation');
  // Mixed in with the facts, a hypothesis still has to say what it is worth.
  expect(screen.getByTestId('timeline-hypothesis-note')).toHaveTextContent(/not confirmed findings/);

  fireEvent.press(screen.getByTestId('chip-kind'));
  expect(await screen.findByTestId('evidence-section-correlation')).toBeTruthy();
  expect(screen.getByTestId('evidence-section-fact')).toBeTruthy();
  expect(screen.getByTestId('evidence-section-hypothesis')).toBeTruthy();
  expect(screen.queryByTestId('investigation-timeline')).toBeNull();
});

it('renders repository evidence with code, diff and the server-side note', async () => {
  renderRouter('./app', { initialUrl: '/evidence/ev-repo-checkout-pricing' });
  expect(await screen.findByTestId('evidence-code', {}, wait)).toHaveTextContent(/const client = await db\.connect\(\);/);
  expect(screen.getByTestId('evidence-diff')).toHaveTextContent(/for \(const line of cart\.lines\)/);
  expect(screen.getByTestId('evidence-file')).toHaveTextContent('src/pricing/cart-pricing.ts');
  expect(screen.getByTestId('evidence-server-side')).toHaveTextContent(/GitHub credentials never reach this device/);
  expect(screen.getByText('Explain this code')).toBeTruthy();
});

it('renders the Morning Brief with the most important problem', async () => {
  renderRouter('./app', { initialUrl: '/brief' });
  expect(await screen.findByTestId('brief-status', {}, wait)).toHaveTextContent('Production: DEGRADED');
  expect(screen.getByTestId('brief-counts')).toHaveTextContent(/^2 critical · 3 warnings · \d+ healthy services$/);
  expect(screen.getByTestId('most-important-problem')).toHaveTextContent(/checkout-api is returning HTTP 5xx/);
  expect(screen.getByTestId('investigate-top-problem')).toBeTruthy();
  expect(screen.getByTestId('change-chg-1')).toBeTruthy();
});

it('groups what changed since yesterday, and dates the briefing', async () => {
  renderRouter('./app', { initialUrl: '/brief' });
  expect(await screen.findByTestId('change-group-new', {}, wait)).toHaveTextContent('NEW · 1');
  expect(screen.getByTestId('change-group-up')).toHaveTextContent('INCREASED · 2');
  expect(screen.getByTestId('change-group-resolved')).toHaveTextContent('RESOLVED · 1');
  // The covered period comes from the server; the bottom line only says when the briefing was put together.
  expect(screen.getByTestId('brief-headline')).toHaveTextContent(/Covers /);
  expect(screen.getByTestId('brief-generated-at')).toHaveTextContent(/^Generated /);
});
