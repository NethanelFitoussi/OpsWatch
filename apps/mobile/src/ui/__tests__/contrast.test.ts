/** WCAG AA (4.5:1) for every foreground/background pair the components use, in both themes. */
import { palettes, type Palette } from '../theme';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const PAIRS: [keyof Palette, keyof Palette][] = [
  ['text', 'background'], ['text', 'surface'], ['textMuted', 'surface'], ['textFaint', 'surface'], ['textFaint', 'background'],
  ['primary', 'surface'], ['onPrimary', 'primary'],
  ['critical', 'criticalBg'], ['warning', 'warningBg'], ['healthy', 'healthyBg'], ['info', 'infoBg'], ['unknown', 'unknownBg'],
  ['production', 'productionBg'], ['demo', 'demoBg'], ['critical', 'surface'], ['warning', 'surface'], ['healthy', 'surface'],
  ['codeText', 'codeBg'], ['diffAdd', 'diffAddBg'], ['diffRemove', 'diffRemoveBg'],
];

describe.each(Object.keys(palettes) as (keyof typeof palettes)[])('%s theme', (theme) => {
  it.each(PAIRS)('%s on %s is at least 4.5:1', (fg, bg) => {
    expect(contrast(palettes[theme][fg], palettes[theme][bg])).toBeGreaterThanOrEqual(4.5);
  });
});
