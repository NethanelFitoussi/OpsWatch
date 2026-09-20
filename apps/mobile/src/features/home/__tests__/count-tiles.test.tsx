/**
 * The three count tiles on Home are the screen's summary, so nothing in them may be cut off. The labels used to be
 * capped at two lines, which was enough at the default font size and not at a large one: at 1.5x the third tile read
 * "of 18 healthy se…" on an Android phone, which is exactly the ambiguity these tiles exist to remove.
 */
import { screen } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';
import type { Health } from '@/api/contract';
import { renderWithProviders } from '@/test/render';
import { CountsRow } from '../components';

const counts: Health['counts'] = { critical: 2, warning: 3, healthyServices: 15, totalServices: 18 };

/**
 * The line caps inside one tile, ignoring the number itself: it is capped to one line on purpose and shrinks to fit
 * rather than truncating.
 */
function labelLineCaps(testID: string): (number | undefined)[] {
  return screen
    .getByTestId(testID)
    .findAllByType(RNText)
    .filter((node) => !node.props.adjustsFontSizeToFit)
    .map((node) => node.props.numberOfLines as number | undefined)
    .filter((lines) => lines !== undefined);
}

it('never caps the lines of a count label, at any font scale', () => {
  renderWithProviders(<CountsRow counts={counts} />);
  expect(screen.getByTestId('count-healthy')).toHaveTextContent(/of 18 healthy services/);
  for (const tile of ['count-critical', 'count-warning', 'count-healthy']) {
    expect(labelLineCaps(tile)).toEqual([]);
  }
});

/** The number is announced with its label, so a screen reader never reads a bare "15". */
it('announces each tile as a number and what it counts', () => {
  renderWithProviders(<CountsRow counts={counts} />);
  expect(screen.getByTestId('count-healthy')).toHaveProp('accessibilityLabel', '15 of 18 healthy services');
  expect(screen.getByTestId('count-critical')).toHaveProp('accessibilityLabel', '2 critical');
});
