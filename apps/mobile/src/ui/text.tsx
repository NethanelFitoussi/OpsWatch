import { Text as RNText, type TextProps } from 'react-native';
import { fontSize, monoFont } from './theme';
import { useTheme } from './theme-provider';

export type TextVariant = 'hero' | 'headline' | 'title' | 'subtitle' | 'body' | 'small' | 'caption' | 'label' | 'mono';
export type TextTone = 'default' | 'muted' | 'faint' | 'primary' | 'critical' | 'warning' | 'healthy' | 'info' | 'onPrimary';

const VARIANTS: Record<TextVariant, { fontSize: number; fontWeight?: '400' | '500' | '600' | '700' | '800'; lineHeight?: number; letterSpacing?: number }> = {
  hero: { fontSize: fontSize.hero, fontWeight: '800', lineHeight: 38 },
  headline: { fontSize: fontSize.headline, fontWeight: '700', lineHeight: 32 },
  title: { fontSize: fontSize.title, fontWeight: '700', lineHeight: 26 },
  subtitle: { fontSize: fontSize.subtitle, fontWeight: '600', lineHeight: 23 },
  body: { fontSize: fontSize.body, lineHeight: 21 },
  small: { fontSize: fontSize.small, lineHeight: 18 },
  caption: { fontSize: fontSize.caption, lineHeight: 16 },
  label: { fontSize: fontSize.caption, fontWeight: '700', letterSpacing: 0.6, lineHeight: 16 },
  mono: { fontSize: fontSize.small, lineHeight: 19 },
};

export type AppTextProps = TextProps & { variant?: TextVariant; tone?: TextTone; weight?: '400' | '500' | '600' | '700' };

/** Text that follows the theme and the system font size (Dynamic Type), capped so layouts stay usable. */
export function Text({ variant = 'body', tone = 'default', weight, style, maxFontSizeMultiplier = 1.8, ...rest }: AppTextProps) {
  const { colors } = useTheme();
  const color =
    tone === 'default'
      ? colors.text
      : tone === 'muted'
        ? colors.textMuted
        : tone === 'faint'
          ? colors.textFaint
          : tone === 'onPrimary'
            ? colors.onPrimary
            : colors[tone];
  return (
    <RNText
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[VARIANTS[variant], variant === 'mono' && { fontFamily: monoFont }, { color }, weight && { fontWeight: weight }, style]}
      {...rest}
    />
  );
}
