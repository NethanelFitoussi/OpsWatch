/**
 * The header pushed screens use while the demo banner is on screen.
 *
 * The stack's native header cannot start flush under the banner on Android: react-native-screens hard-codes the
 * toolbar's top inset since Android 15's edge-to-edge enforcement (`setTopInsetEnabled` is a no-op), so the banner and
 * the header each reserved the status bar height and left an empty strip between them. The navigator swaps in this
 * header for as long as the banner is up. The swap itself cannot be asserted here — the stack does not render any
 * header in the test renderer — so this covers the header's own behaviour, and the layout was checked on a device.
 */
import { fireEvent, screen } from '@testing-library/react-native';
import { renderWithProviders } from '@/test/render';
import { StackHeader } from '../stack-header';

async function header(props: Partial<Parameters<typeof StackHeader>[0]> = {}) {
  const goBack = jest.fn();
  await renderWithProviders(
    <StackHeader
      options={{ title: 'TypeError' }}
      route={{ name: 'errors/[id]' }}
      back={{ title: 'Errors' }}
      navigation={{ goBack }}
      {...props}
    />,
  );
  return goBack;
}

it('shows the screen title', async () => {
  await header();
  expect(screen.getByText('TypeError')).toBeTruthy();
});

it('goes back when the back button is pressed', async () => {
  const goBack = await header();
  fireEvent.press(screen.getByTestId('stack-header-back'));
  expect(goBack).toHaveBeenCalledTimes(1);
});

it('has no back button on a screen that was not pushed', async () => {
  await header({ back: undefined });
  expect(screen.queryByTestId('stack-header-back')).toBeNull();
});

/** The title is the only thing announced as the header; a long one truncates rather than pushing the layout. */
it('names the screen for a screen reader and keeps the title to one line', async () => {
  await header({ options: { title: 'A very long incident title that would otherwise wrap over several lines' } });
  const title = screen.getByRole('header');
  expect(title).toHaveTextContent('A very long incident title that would otherwise wrap over several lines');
  expect(title.props.numberOfLines).toBe(1);
});
