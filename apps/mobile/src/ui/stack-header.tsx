/**
 * The header for pushed screens while the demo banner is on screen.
 *
 * The banner sits above the navigator and already covers the status bar, so everything under it should start with no
 * top inset. That works for the tabs, whose header is drawn in JS and reads the inset we override. It cannot work for
 * the stack's native header: since Android 15's edge-to-edge enforcement react-native-screens hard-codes the toolbar's
 * top inset (`shouldApplyTopInset = true`, and `setTopInsetEnabled` is a no-op), so the native header adds the status
 * bar height a second time and leaves an empty strip under the banner.
 *
 * Drawing the header ourselves in that one case removes the strip on both platforms without depending on how either
 * one treats the inset. When no banner is shown — every signed-in session — the native header is used unchanged.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '@/i18n';
import { Text } from '@/ui/text';
import { spacing } from '@/ui/theme';
import { useTheme } from '@/ui/theme-provider';

export type StackHeaderProps = {
  options: { title?: string };
  route: { name: string };
  back?: unknown;
  navigation: { goBack: () => void };
};

export function StackHeader({ options, navigation, back }: StackHeaderProps) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const title = options.title ?? '';
  return (
    <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      {back ? (
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel={t('action.back')}
          hitSlop={spacing.sm}
          style={styles.back}
          testID="stack-header-back"
        >
          <Ionicons name="arrow-back" size={26} color={colors.primary} />
        </Pressable>
      ) : (
        <View style={styles.back} />
      )}
      <Text variant="subtitle" numberOfLines={1} accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: { width: 32, alignItems: 'flex-start' },
  title: { flexShrink: 1 },
});
