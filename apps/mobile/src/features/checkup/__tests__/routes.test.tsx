/**
 * Checkup through the real router, and the one behaviour that justifies the screen: an empty findings list says
 * something different depending on how much of the catalogue ran.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { screen } from '@testing-library/react-native';
import { fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
import type { Checkup } from '@/api/contract';
import { renderWithProviders, seedDemoSession } from '@/test/render';
import { CheckupBody } from '../components';

jest.setTimeout(20_000);

beforeEach(async () => {
  await AsyncStorage.clear();
});

const empty = (coverage: Checkup['coverage'], notRun: Checkup['notRun'] = []): Checkup => ({
  generatedAt: Date.now(),
  findings: [],
  coverage,
  notRun,
});

it('shows the findings, worst first, with how much of the catalogue ran', async () => {
  await seedDemoSession();
  const app = renderRouter('./app', { initialUrl: '/' });
  await screen.findByTestId('status-title', {}, { timeout: 5000 });
  fireEvent.press(screen.getByTestId('tab-more'));
  fireEvent.press(await screen.findByTestId('more-checkup', {}, { timeout: 5000 }));
  await waitFor(() => expect(app.getPathname()).toBe('/checkup'), { timeout: 5000 });

  expect(await screen.findByTestId('checkup-coverage', {}, { timeout: 5000 })).toHaveTextContent(/10 of 12 checks ran/);
  expect(screen.getByTestId('checkup-coverage-gap')).toHaveTextContent(/2 could not run/);
  expect(screen.getByTestId('checkup-findings')).toHaveTextContent(/No log group is switched on/);
  // The checks that could not run are carried, not dropped, and each says why.
  expect(screen.getByTestId('checkup-notrun')).toHaveTextContent(/permission this needs was refused/);
});

/**
 * The distinction the whole screen is built around. Both of these have no findings; only one of them is good news,
 * and the app must not let them read the same.
 */
it('will not call a partial run a clean bill of health', async () => {
  await renderWithProviders(<CheckupBody checkup={empty({ ran: 5, notRun: 7, total: 12 }, [{ id: 'logs_budget', reason: 'denied', values: {} }])} />);
  expect(screen.getByTestId('empty-state')).toHaveTextContent(/not a clean bill of health/);
  expect(screen.getByTestId('checkup-coverage-gap')).toBeTruthy();
});

it('says everything is fine only when everything ran', async () => {
  await renderWithProviders(<CheckupBody checkup={empty({ ran: 12, notRun: 0, total: 12 })} />);
  expect(screen.getByTestId('empty-state')).toHaveTextContent(/found nothing wrong/);
  expect(screen.queryByTestId('checkup-coverage-gap')).toBeNull();
});

it('names a check it does not recognise instead of hiding it', async () => {
  const future: Checkup = {
    generatedAt: Date.now(),
    findings: [{ id: 'invented_next_year', severity: 'critical', subject: null, values: {} }],
    coverage: { ran: 1, notRun: 0, total: 1 },
    notRun: [],
  };
  await renderWithProviders(<CheckupBody checkup={future} />);
  expect(screen.getByTestId('checkup-finding-invented_next_year')).toHaveTextContent(/does not recognise/);
  expect(screen.getByTestId('checkup-unknown-invented_next_year')).toHaveTextContent('invented_next_year');
});

/**
 * No unfilled placeholder may reach a screen.
 *
 * A check that could not run carries no values, and it was being described with the sentence a *finding* uses — so
 * "the stack is version {version}; the current one is {current}" appeared on a device, braces and all. The specific
 * bug is fixed by giving not-run entries the check's name instead; this asserts the class of it, over every check
 * the server can emit, in both languages.
 */
describe('no unfilled placeholder ever reaches the screen', () => {
  const CHECKS = [
    'permissions_untested',
    'permissions_denied',
    'permissions_errored',
    'account_mismatch',
    'family_unreadable',
    'errors_not_collected',
    'history_off',
    'logs_budget',
    'logs_budget_exhausted',
    'collector_never_ran',
    'collector_job_failing',
    'template_outdated',
    'a_check_from_a_newer_server',
  ];

  it.each(['en', 'fr'] as const)('for every check the server can emit, with no values at all (%s)', async (locale) => {
    const checkup: Checkup = {
      generatedAt: Date.now(),
      // Every check as a finding *and* as a not-run entry, all with empty values: the worst case for substitution.
      findings: CHECKS.map((id) => ({ id, severity: 'warning' as const, subject: null, values: {} })),
      coverage: { ran: CHECKS.length, notRun: CHECKS.length, total: CHECKS.length * 2 },
      notRun: CHECKS.map((id) => ({ id, reason: 'denied' as const, values: {} })),
    };

    await renderWithProviders(<CheckupBody checkup={checkup} />, { locale });

    const text = JSON.stringify(screen.toJSON());
    const leaked = [...text.matchAll(/\{[a-zA-Z]+\}/g)].map((m) => m[0]);
    expect(leaked).toEqual([]);
  });
});
