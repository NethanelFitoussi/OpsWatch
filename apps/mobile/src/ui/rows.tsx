/**
 * Rich list rows and small shared pieces: a row with a meta line and a one-line detail, a status badge from a
 * tone/icon/label triple, the not-found state of detail screens, and a timestamped list item.
 */
import { Ionicons } from '@expo/vector-icons';
import { memo, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useI18n } from '@/i18n';
import { Badge } from './badges';
import type { IconName } from './layout';
import { EmptyState } from './states';
import { Text } from './text';
import { spacing, TOUCH_TARGET, type Tone } from './theme';
import { useTheme } from './theme-provider';

export type StatusMeta = { tone: Tone; icon: IconName; label: string };

export function StatusBadge({ meta, size, testID }: { meta: StatusMeta; size?: 'small' | 'large'; testID?: string }) {
  return <Badge tone={meta.tone} icon={meta.icon} label={meta.label} size={size} testID={testID} />;
}

type RichRowProps = {
  title: string;
  /** Second line: who/what/when. */
  meta?: string;
  /** Third line, truncated to one line. */
  detail?: string;
  left?: ReactNode;
  /** Shown outside the pressable area, for independent controls. */
  right?: ReactNode;
  /**
   * Extra content under the text (a budget bar, a status badge). It sits inside the pressable, so a screen reader
   * reads the row as one element: anything meaningful in here must also be in `accessibilityLabel`.
   */
  extra?: ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
};

/** A pressable list row with up to three lines of text; at least one touch target tall. */
export const RichRow = memo(function RichRow({ title, meta, detail, left, right, extra, onPress, accessibilityLabel, testID }: RichRowProps) {
  const { colors } = useTheme();
  // `right` sits outside the pressable so its own controls (a favorite star) stay reachable by screen readers.
  return (
    <View style={styles.container}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        testID={testID}
        style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceAlt }]}
      >
        {left ? <View style={styles.left}>{left}</View> : null}
        <View style={styles.text}>
          <Text variant="body" weight="600" numberOfLines={2}>
            {title}
          </Text>
          {meta ? (
            <Text variant="small" tone="muted" numberOfLines={2}>
              {meta}
            </Text>
          ) : null}
          {detail ? (
            <Text variant="small" tone="faint" numberOfLines={1}>
              {detail}
            </Text>
          ) : null}
          {extra}
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} importantForAccessibility="no" />
      </Pressable>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
});

/** Detail screens show this for an id that fails validation or no longer exists. */
export function NotFoundState({ title }: { title?: string }) {
  const { t } = useI18n();
  return <EmptyState icon="search-outline" title={title ?? t('error.not_found')} />;
}

/** One entry of a chronological list: time on the left, content on the right. */
export function TimedItem({ time, children, testID }: { time: string; children: ReactNode; testID?: string }) {
  return (
    <View style={styles.timed} testID={testID}>
      <Text variant="small" weight="700" style={styles.time}>
        {time}
      </Text>
      <View style={styles.timedBody}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center' },
  right: { paddingRight: spacing.md },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TOUCH_TARGET + 8,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  left: { alignSelf: 'flex-start', paddingTop: 2 },
  text: { flex: 1, gap: 2 },
  timed: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.xs },
  // Bounded: at a large font scale a date+time string would otherwise squeeze the content column out of the row.
  time: { minWidth: 52, maxWidth: 110, fontVariant: ['tabular-nums'] },
  timedBody: { flex: 1, gap: 2 },
});
