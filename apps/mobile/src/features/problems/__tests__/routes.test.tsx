import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { PREF_KEYS } from '@/state/storage';
import { seedDemoSession } from '@/test/render';

jest.setTimeout(20_000);

beforeEach(async () => {
  await AsyncStorage.clear();
  await seedDemoSession();
});

const wait = { timeout: 5000 };

describe('Problems list', () => {
  it('shows open problems by default, and only the resolved one when Resolved is chosen', async () => {
    renderRouter('./app', { initialUrl: '/problems' });
    expect(await screen.findByTestId('problems-row-prb-checkout-5xx', {}, wait)).toBeTruthy();
    expect(screen.queryByTestId('problems-row-prb-catalog-tasks')).toBeNull();

    fireEvent.press(screen.getByTestId('chip-resolved'));
    const resolved = await screen.findByTestId('problems-row-prb-catalog-tasks', {}, wait);
    expect(screen.queryByTestId('problems-row-prb-checkout-5xx')).toBeNull();
    expect(screen.queryByTestId('problems-row-prb-redis-latency')).toBeNull();
    // A row that is over says so in its tense, and never keeps counting up.
    expect(resolved).toHaveTextContent(/lasted /);
    expect(resolved).toHaveTextContent(/ended /);
    expect(resolved).not.toHaveTextContent(/ongoing for/);
  });

  it('shows how long an open problem has been going, and when it was last seen', async () => {
    renderRouter('./app', { initialUrl: '/problems' });
    const row = await screen.findByTestId('problems-row-prb-checkout-5xx', {}, wait);
    expect(row).toHaveTextContent(/checkout-api/);
    expect(row).toHaveTextContent(/ongoing for /);
    expect(row).toHaveTextContent(/last seen /);
  });

  it('filters by severity', async () => {
    renderRouter('./app', { initialUrl: '/problems' });
    await screen.findByTestId('problems-row-prb-checkout-5xx', {}, wait);

    fireEvent.press(screen.getByTestId('chip-warning'));
    expect(await screen.findByTestId('problems-row-prb-redis-latency', {}, wait)).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('problems-row-prb-checkout-5xx')).toBeNull(), wait);
  });

  /**
   * The category chips were removed when the contract declared which filters each endpoint honours: `category` is
   * not one of them, and an undeclared parameter is now a 400 rather than something the server ignores. Offering a
   * chip that breaks the list is worse than not offering it.
   */
  it('offers no filter the server would reject', async () => {
    renderRouter('./app', { initialUrl: '/problems' });
    await screen.findByTestId('problems-row-prb-checkout-5xx', {}, wait);
    expect(screen.queryByTestId('chip-cat:containers')).toBeNull();
    expect(screen.queryByTestId('chip-cat:all')).toBeNull();
  });

  // External links drop query strings (deep-link allow-list), so the service filter is reached by in-app navigation.
  it('narrows to one service from the route parameter, and the filter can be cleared', async () => {
    renderRouter('./app', { initialUrl: '/' });
    await screen.findByTestId('home-screen', {}, wait);
    act(() => router.push('/problems?service=svc-orders-worker'));
    expect(await screen.findByTestId('problems-row-prb-orders-worker-cpu', {}, wait)).toBeTruthy();
    expect(screen.queryByTestId('problems-row-prb-checkout-5xx')).toBeNull();
    expect(screen.getByTestId('problems-service-filter')).toHaveTextContent(/Service: orders-worker/);

    fireEvent.press(screen.getByTestId('problems-service-filter'));
    expect(await screen.findByTestId('problems-row-prb-checkout-5xx', {}, wait)).toBeTruthy();
  });

  it('says so plainly when filters match nothing', async () => {
    renderRouter('./app', { initialUrl: '/problems' });
    await screen.findByTestId('problems-row-prb-checkout-5xx', {}, wait);
    fireEvent.press(screen.getByTestId('chip-info'));
    const empty = await screen.findByTestId('empty-state', {}, wait);
    expect(empty).toHaveTextContent(/No problems match these filters/);
    // Why it is empty, in words, and a way out that is always on screen.
    expect(empty).toHaveTextContent(/Active filters — Severity: Info/);
    fireEvent.press(screen.getByTestId('problems-clear-filters'));
    expect(await screen.findByTestId('problems-row-prb-checkout-5xx', {}, wait)).toBeTruthy();
  });
  it('is reassuring when nothing is open', async () => {
    // The demo staging environment has no problems.
    await AsyncStorage.setItem(PREF_KEYS.settings, JSON.stringify({ environmentId: 'staging-eu-west-1' }));
    renderRouter('./app', { initialUrl: '/problems' });
    const empty = await screen.findByTestId('empty-state', {}, wait);
    expect(empty).toHaveTextContent(/No open problems/);
    expect(empty).toHaveTextContent(/Nothing needs your attention right now/);
  });
});

describe('Problem detail', () => {
  it('keeps facts and hypotheses apart and states the deployment timing as a fact', async () => {
    renderRouter('./app', { initialUrl: '/problems/prb-checkout-5xx' });
    expect(await screen.findByTestId('problem-title', {}, wait)).toHaveTextContent('checkout-api is returning HTTP 5xx');
    expect(screen.getByTestId('evidence-section-fact')).toBeTruthy();
    expect(screen.getByTestId('evidence-section-hypothesis')).toHaveTextContent(/Connection pool exhaustion/);
    expect(screen.getByTestId('problem-deployment-dep-checkout-2140')).toHaveTextContent(/Started 9 min after deployment v2\.14\.0 of checkout-api/);
    expect(screen.getByTestId('problem-evidence-ev-repo-checkout-pricing')).toBeTruthy();
    expect(screen.getByTestId('problem-open-investigation')).toBeTruthy();
    expect(screen.getByTestId('ask-ai')).toBeTruthy();
  });

  it('acknowledges the problem when the server allows it', async () => {
    renderRouter('./app', { initialUrl: '/problems/prb-checkout-5xx' });
    expect(await screen.findByTestId('problem-status', {}, wait)).toHaveTextContent(/Active/);
    fireEvent.press(screen.getByTestId('problem-acknowledge'));
    expect(await screen.findByTestId('problem-acknowledged', {}, wait)).toHaveTextContent('Problem acknowledged.');
    await waitFor(() => expect(screen.getByTestId('problem-status')).toHaveTextContent(/Acknowledged/), wait);
    expect(screen.queryByTestId('problem-acknowledge')).toBeNull();
  });

  it('leaves out the sections the server has nothing for, instead of showing empty shells', async () => {
    renderRouter('./app', { initialUrl: '/problems/prb-status-ssl' });
    await screen.findByTestId('problem-title', {}, wait);
    expect(screen.queryByText('EVIDENCE AND POSSIBLE CAUSES')).toBeNull();
    expect(screen.queryByText('Metrics')).toBeNull();
    expect(screen.queryByText('Deployment correlation')).toBeNull();
    expect(screen.queryByTestId('problem-deployments')).toBeNull();
  });

  it('offers no Acknowledge action when it is not allowed', async () => {
    renderRouter('./app', { initialUrl: '/problems/prb-redis-latency' });
    expect(await screen.findByTestId('problem-title', {}, wait)).toBeTruthy();
    expect(screen.queryByTestId('problem-acknowledge')).toBeNull();
  });
});
