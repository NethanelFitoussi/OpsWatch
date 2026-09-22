/**
 * Minimum touch targets.
 *
 * Apple asks for 44 pt and Material for 48 dp; `TOUCH_TARGET` is 48, which covers both. List rows reach it by being
 * that tall. Inline controls — a "show more" toggle, a link at the end of a line of prose — cannot be, without looking
 * like buttons and pushing the surrounding text apart, so they grow their touch area instead of their box. These
 * assert that the second kind really does reach the target, since nothing about the layout reveals it.
 */
import { screen } from '@testing-library/react-native';
import { renderWithProviders } from '@/test/render';
import { StackTraceViewer } from '../code';
import { slopToTouchTarget, TOUCH_TARGET } from '../theme';

/** What the OS will actually accept a tap in: the box plus the slop above and below it. */
function effectiveHeight(element: { props: { style?: unknown; hitSlop?: number } }): number {
  const styles = [element.props.style].flat(3).filter(Boolean) as { minHeight?: number }[];
  const box = styles.reduce((found, s) => s?.minHeight ?? found, 0);
  const slop = element.props.hitSlop ?? 0;
  return box + slop * 2;
}

it('lifts a control to the touch target, and never shrinks one already big enough', async () => {
  expect(32 + slopToTouchTarget(32) * 2).toBeGreaterThanOrEqual(TOUCH_TARGET);
  expect(36 + slopToTouchTarget(36) * 2).toBeGreaterThanOrEqual(TOUCH_TARGET);
  expect(slopToTouchTarget(TOUCH_TARGET)).toBe(0);
  expect(slopToTouchTarget(96)).toBe(0);
});

it('gives the stack trace toggle a full touch target despite its compact height', async () => {
  await renderWithProviders(
    <StackTraceViewer
      frames={[
        { file: 'src/cart.ts', line: 42, column: 7, function: 'priceCart', inApp: true, context: undefined },
        { file: 'node_modules/lodash/map.js', line: 9, column: 1, function: 'map', inApp: false, context: undefined },
      ]}
    />,
  );
  expect(effectiveHeight(screen.getByTestId('toggle-library-frames'))).toBeGreaterThanOrEqual(TOUCH_TARGET);
});
