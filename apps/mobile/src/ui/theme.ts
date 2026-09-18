/**
 * Design tokens. Two palettes with the same keys; components read colours only through `useTheme()`.
 * Status colours meet WCAG AA against their `*Bg` tint and are always paired with an icon and a word.
 */
import type { HealthStatus, Severity } from '@/api/contract';

export type Palette = {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  primary: string;
  onPrimary: string;
  critical: string;
  criticalBg: string;
  warning: string;
  warningBg: string;
  healthy: string;
  healthyBg: string;
  info: string;
  infoBg: string;
  unknown: string;
  unknownBg: string;
  production: string;
  productionBg: string;
  demo: string;
  demoBg: string;
  codeBg: string;
  codeText: string;
  codeLineHighlight: string;
  diffAdd: string;
  diffAddBg: string;
  diffRemove: string;
  diffRemoveBg: string;
  chartLine: string;
  chartFill: string;
  chartGrid: string;
  overlay: string;
};

const light: Palette = {
  background: '#F6F7F9',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF1F5',
  border: '#D9DEE7',
  text: '#101828',
  textMuted: '#475467',
  textFaint: '#667085',
  primary: '#1D4ED8',
  onPrimary: '#FFFFFF',
  critical: '#B42318',
  criticalBg: '#FEE4E2',
  warning: '#8A4B00',
  warningBg: '#FEF0C7',
  healthy: '#067647',
  healthyBg: '#DCFAE6',
  info: '#175CD3',
  infoBg: '#D1E9FF',
  unknown: '#475467',
  unknownBg: '#EAECF0',
  production: '#9E165F',
  productionBg: '#FCE7F6',
  demo: '#6927DA',
  demoBg: '#EBE9FE',
  codeBg: '#F2F4F7',
  codeText: '#101828',
  codeLineHighlight: '#FEF0C7',
  diffAdd: '#067647',
  diffAddBg: '#DCFAE6',
  diffRemove: '#B42318',
  diffRemoveBg: '#FEE4E2',
  chartLine: '#1D4ED8',
  chartFill: 'rgba(29, 78, 216, 0.12)',
  chartGrid: '#E4E7EC',
  overlay: 'rgba(16, 24, 40, 0.5)',
};

const dark: Palette = {
  background: '#0B1220',
  surface: '#131C2E',
  surfaceAlt: '#1B2640',
  border: '#2A3857',
  text: '#F2F4F7',
  textMuted: '#C0C8D6',
  textFaint: '#98A2B3',
  primary: '#7CA5FF',
  onPrimary: '#0B1220',
  critical: '#FDA29B',
  criticalBg: '#4A1512',
  warning: '#FEC84B',
  warningBg: '#3F2A06',
  healthy: '#75E0A7',
  healthyBg: '#0B3A26',
  info: '#84CAFF',
  infoBg: '#0E2F55',
  unknown: '#C0C8D6',
  unknownBg: '#2A3445',
  production: '#FAA7E0',
  productionBg: '#4E0D30',
  demo: '#BDB4FE',
  demoBg: '#2C1C5F',
  codeBg: '#0F1729',
  codeText: '#E4E7EC',
  codeLineHighlight: '#3F2A06',
  diffAdd: '#75E0A7',
  diffAddBg: '#0B3A26',
  diffRemove: '#FDA29B',
  diffRemoveBg: '#4A1512',
  chartLine: '#7CA5FF',
  chartFill: 'rgba(124, 165, 255, 0.18)',
  chartGrid: '#24324D',
  overlay: 'rgba(0, 0, 0, 0.6)',
};

export const palettes = { light, dark } as const;
export type ColorSchemeName = keyof typeof palettes;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 14, pill: 999 } as const;
/** Minimum touch target (Apple HIG 44 pt, Material 48 dp): 48 covers both. */
export const TOUCH_TARGET = 48;

export const fontSize = { caption: 12, small: 13, body: 15, subtitle: 17, title: 20, headline: 26, hero: 32 } as const;
export const monoFont = 'Menlo';

export type Tone = 'critical' | 'warning' | 'healthy' | 'info' | 'unknown';

export function toneForHealth(status: HealthStatus): Tone {
  switch (status) {
    case 'critical':
      return 'critical';
    case 'degraded':
      return 'warning';
    case 'healthy':
      return 'healthy';
    case 'unknown':
      return 'unknown';
  }
}

export function toneForSeverity(severity: Severity): Tone {
  return severity === 'critical' ? 'critical' : severity === 'warning' ? 'warning' : 'info';
}

export function toneColors(palette: Palette, tone: Tone): { fg: string; bg: string } {
  return { fg: palette[tone], bg: palette[`${tone}Bg`] };
}
