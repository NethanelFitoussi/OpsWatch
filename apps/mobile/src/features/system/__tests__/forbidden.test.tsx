/**
 * `/system/status` is administrator-only. For everyone else the server answers 403, and that is an ordinary outcome
 * rather than a failure: the account works, the rest of the app works, and there is nothing to retry. Showing the
 * generic permission error would tell someone they had hit a problem when they had simply opened a page that is not
 * theirs — and offering a retry would invite them to keep asking a question whose answer will not change.
 */
import { screen } from '@testing-library/react-native';
import { ApiError } from '@/api/errors';
import { renderWithProviders } from '@/test/render';
import SystemScreen from '../../../../app/(app)/system';

jest.mock('@/api/queries', () => ({
  ...jest.requireActual('@/api/queries'),
  useSystemStatus: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useSystemStatus } = require('@/api/queries') as { useSystemStatus: jest.Mock };

function answering(over: Record<string, unknown>) {
  useSystemStatus.mockReturnValue({
    data: undefined,
    error: null,
    isPending: false,
    isRefetching: false,
    isRefetchError: false,
    isFetching: false,
    dataUpdatedAt: Date.now(),
    refetch: jest.fn(),
    ...over,
  });
}

it('explains that the page belongs to an administrator, without calling it an error', async () => {
  answering({ error: new ApiError('forbidden') });
  await renderWithProviders(<SystemScreen />);

  expect(screen.getByTestId('empty-state')).toHaveTextContent(/administrator/);
  // Not the generic error card, and nothing to retry.
  expect(screen.queryByTestId('error-state')).toBeNull();
  expect(screen.queryByTestId('error-retry')).toBeNull();
});

it('still reports a real failure as a failure', async () => {
  answering({ error: new ApiError('network') });
  await renderWithProviders(<SystemScreen />);

  expect(screen.queryByTestId('empty-state')).toBeNull();
  expect(screen.getByTestId('error-retry')).toBeTruthy();
});
