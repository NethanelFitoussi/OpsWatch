export const SPARKLINE_WIDTH = 80;
export const SPARKLINE_HEIGHT = 24;

const round = (n: number) => Math.round(n * 100) / 100;

export function sparklinePoints(values: readonly number[], width = SPARKLINE_WIDTH, height = SPARKLINE_HEIGHT, max?: number): string {
  if (values.length === 0) return '';
  const bottom = Math.min(0, ...values);
  const top = max ?? Math.max(...values);
  const span = top - bottom || 1;
  const y = (v: number) => round(height - ((v - bottom) / span) * height);
  if (values.length === 1) return `0,${y(values[0])} ${width},${y(values[0])}`;
  const step = width / (values.length - 1);
  return values.map((v, i) => `${round(i * step)},${y(v)}`).join(' ');
}
