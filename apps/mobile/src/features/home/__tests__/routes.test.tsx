import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { seedDemoSession } from '@/test/render';

jest.setTimeout(20_000);

beforeEach(async () => {
  await AsyncStorage.clear();
  await seedDemoSession();
});

const wait = { timeout: 5000 };

describe('Home', () => {
  it('answers "healthy?", "do I act?" and "what is worst?" before anything else', async () => {
    renderRouter('./app', { initialUrl: '/' });
    expect(await screen.findByTestId('status-title', {}, wait)).toHaveTextContent('Degraded');
    expect(screen.getByTestId('action-verdict')).toHaveTextContent('Yes: 2 critical problems are open.');
    expect(screen.getByTestId('count-critical')).toHaveTextContent(/2critical/);

    const top = screen.getByTestId('most-important-problem');
    expect(top).toHaveTextContent(/checkout-api is returning HTTP 5xx/);
    // A length of time, not an instant: "since 3 h ago" would read as a moment.
    expect(top).toHaveTextContent(/ongoing for/);
    expect(screen.getByTestId('investigate-top-problem')).toBeTruthy();
  });

  it('says the view is partial when OpsWatch could not read a family, and why', async () => {
    renderRouter('./app', { initialUrl: '/' });
    expect(await screen.findByTestId('coverage-caveat', {}, wait)).toHaveTextContent(/could not check CDN/);
    expect(screen.getByTestId('family-cloudfront')).toHaveTextContent(/denied \(AccessDenied\)/);
    expect(screen.getByTestId('family-cloudfront')).not.toHaveTextContent(/Healthy/);
  });

  it('tells how old the server snapshot is, separately from the last refresh', async () => {
    renderRouter('./app', { initialUrl: '/' });
    expect(await screen.findByTestId('health-generated-at', {}, wait)).toHaveTextContent(/Checked by the server/);
  });

  it('opens the problems narrowed to critical from the critical count, and the filter can be cleared', async () => {
    renderRouter('./app', { initialUrl: '/' });
    await screen.findByTestId('count-critical', {}, wait);
    fireEvent.press(screen.getByTestId('count-critical'));

    expect(await screen.findByTestId('problems-row-prb-aurora-connections', {}, wait)).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('problems-row-prb-redis-latency')).toBeNull(), wait);

    fireEvent.press(screen.getByTestId('problems-clear-filters'));
    expect(await screen.findByTestId('problems-row-prb-redis-latency', {}, wait)).toBeTruthy();
  });
});
