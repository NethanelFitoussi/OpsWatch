/**
 * Viewers for code, stack traces, log lines and diffs. Long lines scroll horizontally instead of wrapping into
 * unreadable columns; text is selectable; copying is always an explicit action.
 */
import { Ionicons } from '@expo/vector-icons';
import { memo, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { StackFrame } from '@/api/contract';
import { useI18n } from '@/i18n';
import { prettyLog } from '@/lib/format';
import { CopyButton } from './controls';
import { Text } from './text';
import { monoFont, radius, spacing } from './theme';
import { useTheme } from './theme-provider';

const MONO = { fontFamily: monoFont, fontSize: 12.5, lineHeight: 19 } as const;

export const CodeBlock = memo(function CodeBlock({
  lines,
  startLine = 1,
  highlight = [],
  title,
  copyText,
  testID,
}: {
  lines: string[];
  startLine?: number;
  highlight?: number[];
  title?: string;
  copyText?: string;
  testID?: string;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const highlightLabel = t('code.highlighted');
  const gutter = String(startLine + lines.length - 1).length;
  const highlighted = useMemo(() => new Set(highlight), [highlight]);
  return (
    <View style={[styles.block, { backgroundColor: colors.codeBg, borderColor: colors.border }]} testID={testID}>
      <View style={styles.blockHeader}>
        <Text variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
          {title ?? ''}
        </Text>
        <CopyButton text={copyText ?? lines.join('\n')} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.codeScroll}>
        <View>
          {lines.map((line, i) => {
            const number = startLine + i;
            const isHighlighted = highlighted.has(number);
            return (
              <View key={number} style={[styles.codeLine, isHighlighted && { backgroundColor: colors.codeLineHighlight }]}>
                <Text style={[MONO, { color: colors.textFaint, width: gutter * 8 + 10, textAlign: 'right' }]} selectable={false}>
                  {number}
                </Text>
                <Text style={[MONO, { color: isHighlighted ? colors.warning : colors.textFaint, width: 14 }]} accessibilityLabel={isHighlighted ? highlightLabel : undefined}>
                  {isHighlighted ? '▶' : ' '}
                </Text>
                <Text style={[MONO, { color: colors.codeText }]} selectable>
                  {line || ' '}
                </Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
});

function frameLocation(frame: StackFrame): string {
  if (!frame.file) return '';
  return `${frame.file}${frame.line !== undefined ? `:${frame.line}` : ''}${frame.column !== undefined ? `:${frame.column}` : ''}`;
}

const FrameRow = memo(function FrameRow({ frame, index }: { frame: StackFrame; index: number }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [open, setOpen] = useState(frame.inApp && index === 0);
  const hasContext = !!frame.context?.length;
  return (
    <View style={[styles.frame, { borderColor: colors.border }, frame.inApp && { borderLeftColor: colors.primary, borderLeftWidth: 3 }]}>
      <Pressable
        onPress={hasContext ? () => setOpen((o) => !o) : undefined}
        disabled={!hasContext}
        accessibilityRole={hasContext ? 'button' : 'text'}
        accessibilityState={hasContext ? { expanded: open } : undefined}
        accessibilityLabel={`${t(frame.inApp ? 'code.appFrame' : 'code.libraryFrame')}: ${frame.function ?? t('code.anonymous')} ${frameLocation(frame)}`}
        style={styles.frameHead}
      >
        {hasContext ? <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={14} color={colors.textMuted} importantForAccessibility="no" /> : <View style={{ width: 14 }} />}
        <View style={{ flex: 1 }}>
          <Text variant="small" weight={frame.inApp ? '700' : '400'} tone={frame.inApp ? 'default' : 'muted'} style={{ fontFamily: monoFont }} numberOfLines={2}>
            {frame.function ?? `<${t('code.anonymous')}>`}
          </Text>
          {frame.file ? (
            <Text variant="caption" tone="faint" style={{ fontFamily: monoFont }} numberOfLines={2}>
              {frameLocation(frame)}
            </Text>
          ) : null}
        </View>
        {frame.inApp ? (
          <View style={[styles.appTag, { backgroundColor: colors.infoBg }]}>
            <Text variant="caption" weight="700" style={{ color: colors.info }}>
              {t('code.appTag')}
            </Text>
          </View>
        ) : null}
      </Pressable>
      {open && frame.context ? (
        <CodeBlock lines={frame.context.map((c) => c.code)} startLine={frame.context[0]!.line} highlight={frame.line !== undefined ? [frame.line] : []} title={frame.file} />
      ) : null}
    </View>
  );
});

/**
 * Stack trace: application frames emphasised, consecutive library frames folded behind a "N library frames" toggle,
 * raw trace available for copying.
 */
export function StackTraceViewer({ frames, rawStack, testID }: { frames: StackFrame[]; rawStack?: string; testID?: string }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const [showLibrary, setShowLibrary] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const libraryCount = frames.filter((f) => !f.inApp).length;

  // Group consecutive library frames so the app frames stay visible in order.
  const groups = useMemo(() => {
    const out: ({ kind: 'frame'; frame: StackFrame; index: number } | { kind: 'folded'; count: number; start: number })[] = [];
    frames.forEach((frame, index) => {
      if (frame.inApp || showLibrary) {
        out.push({ kind: 'frame', frame, index });
      } else {
        const last = out[out.length - 1];
        if (last?.kind === 'folded') last.count += 1;
        else out.push({ kind: 'folded', count: 1, start: index });
      }
    });
    return out;
  }, [frames, showLibrary]);

  return (
    <View style={styles.trace} testID={testID}>
      <View style={styles.traceActions}>
        {libraryCount > 0 ? (
          <Pressable onPress={() => setShowLibrary((s) => !s)} accessibilityRole="button" style={styles.toggle} testID="toggle-library-frames">
            <Text variant="small" weight="600" tone="primary">
              {showLibrary ? t('action.showLess') : `${t('action.showMore')} (${libraryCount})`}
            </Text>
          </Pressable>
        ) : (
          <View />
        )}
        {rawStack ? (
          <View style={styles.row}>
            <Pressable onPress={() => setShowRaw((s) => !s)} accessibilityRole="button" style={styles.toggle}>
              <Text variant="small" weight="600" tone="primary">
                {showRaw ? t('code.frames') : t('code.raw')}
              </Text>
            </Pressable>
            <CopyButton text={rawStack} />
          </View>
        ) : null}
      </View>
      {showRaw && rawStack ? (
        <CodeBlock lines={rawStack.split('\n')} title={t('code.stack')} />
      ) : (
        groups.map((group) =>
          group.kind === 'frame' ? (
            <FrameRow key={group.index} frame={group.frame} index={group.index} />
          ) : (
            <Pressable
              key={`folded-${group.start}`}
              onPress={() => setShowLibrary(true)}
              accessibilityRole="button"
              style={[styles.folded, { borderColor: colors.border }]}
            >
              <Text variant="caption" tone="muted">
                ··· {t(group.count > 1 ? 'code.libraryFrames' : 'code.libraryFrame1', { count: group.count })}
              </Text>
            </Pressable>
          ),
        )
      )}
    </View>
  );
}

/** A log line, pretty-printed when it is JSON. */
export const LogBlock = memo(function LogBlock({ message, title }: { message: string; title?: string }) {
  const { pretty, isJson } = useMemo(() => prettyLog(message), [message]);
  return <CodeBlock lines={pretty.split('\n')} title={title ?? (isJson ? 'JSON' : undefined)} copyText={message} />;
});

/** Unified diff with +/− markers in text (not only colour). */
export const DiffView = memo(function DiffView({ diff, title }: { diff: string; title?: string }) {
  const { colors } = useTheme();
  const lines = diff.split('\n');
  return (
    <View style={[styles.block, { backgroundColor: colors.codeBg, borderColor: colors.border }]}>
      <View style={styles.blockHeader}>
        <Text variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
          {title ?? 'diff'}
        </Text>
        <CopyButton text={diff} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.codeScroll}>
        <View>
          {lines.map((line, i) => {
            const added = line.startsWith('+');
            const removed = line.startsWith('-');
            const hunk = line.startsWith('@@');
            return (
              <View key={i} style={[styles.codeLine, added && { backgroundColor: colors.diffAddBg }, removed && { backgroundColor: colors.diffRemoveBg }]}>
                <Text
                  selectable
                  style={[MONO, { color: added ? colors.diffAdd : removed ? colors.diffRemove : hunk ? colors.info : colors.codeText }]}
                >
                  {line || ' '}
                </Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  block: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  blockHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingTop: spacing.xs, gap: spacing.sm },
  codeScroll: { paddingVertical: spacing.sm, paddingRight: spacing.lg },
  codeLine: { flexDirection: 'row', paddingHorizontal: spacing.sm },
  trace: { gap: spacing.sm },
  traceActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  toggle: { minHeight: 32, justifyContent: 'center' },
  frame: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: 'hidden', gap: spacing.xs },
  frameHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, minHeight: 48 },
  appTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm },
  folded: { borderWidth: StyleSheet.hairlineWidth, borderStyle: 'dashed', borderRadius: radius.md, padding: spacing.sm, alignItems: 'center', minHeight: 36, justifyContent: 'center' },
});
