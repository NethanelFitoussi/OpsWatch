/**
 * Virtualised list screens. `ListScreen` renders an array query; `InfiniteListScreen` renders a cursor-paginated
 * query and loads the next page near the end. Both handle loading, error without data, empty, pull to refresh and the
 * freshness line, so feature screens only provide rows and filters.
 */
import type { InfiniteData, UseInfiniteQueryResult, UseQueryResult } from '@tanstack/react-query';
import { useCallback, type ReactElement, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View, type ListRenderItem } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Page } from '@/api/contract';
import { useI18n } from '@/i18n';
import { Divider } from './layout';
import { MAX_CONTENT_WIDTH } from './screen';
import { EmptyState, ErrorState, Freshness, LoadingState } from './states';
import { Text } from './text';
import { radius, spacing } from './theme';
import { useTheme } from './theme-provider';
import type { IconName } from './layout';

type CommonProps<T> = {
  renderItem: ListRenderItem<T>;
  keyExtractor: (item: T) => string;
  /** Filters and summaries shown above the rows; they scroll with the list. */
  header?: ReactNode;
  empty: { title: string; body?: string; icon?: IconName };
  testID?: string;
  /** Rows are drawn as one grouped card by default. */
  plain?: boolean;
};

function useListChrome() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return {
    colors,
    contentStyle: [styles.content, { paddingBottom: insets.bottom + spacing.xxl }],
  };
}

function Header({ header, updatedAt, refreshFailed, fetching, onRetry }: { header?: ReactNode; updatedAt: number; refreshFailed: boolean; fetching: boolean; onRetry: () => void }) {
  return (
    <View style={styles.header}>
      <View style={styles.inset}>
        <Freshness updatedAt={updatedAt} refreshFailed={refreshFailed} fetching={fetching} onRetry={onRetry} />
      </View>
      {header}
    </View>
  );
}

function wrapRow<T>(renderItem: ListRenderItem<T>, plain: boolean | undefined, surface: string, border: string, count: number): ListRenderItem<T> {
  if (plain) return renderItem;
  // eslint-disable-next-line react/display-name
  return (info) => (
    <View
      style={[
        styles.row,
        { backgroundColor: surface, borderColor: border },
        info.index === 0 && styles.first,
        info.index === count - 1 && styles.last,
      ]}
    >
      {info.index > 0 ? <Divider /> : null}
      {renderItem(info) as ReactElement}
    </View>
  );
}

export function ListScreen<T>({ query, ...props }: CommonProps<T> & { query: UseQueryResult<T[]> }) {
  const { colors, contentStyle } = useListChrome();
  const items = query.data ?? [];
  const retry = () => void query.refetch();
  // Loading and failure stay inside the list, so the filters above the rows never disappear underneath the user.
  const failed = !query.isPending && query.data === undefined;
  return (
    <FlatList
      testID={props.testID}
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={contentStyle}
      data={items}
      keyExtractor={props.keyExtractor}
      renderItem={wrapRow(props.renderItem, props.plain, colors.surface, colors.border, items.length)}
      ListHeaderComponent={<Header header={props.header} updatedAt={query.dataUpdatedAt} refreshFailed={!!query.error} fetching={query.isFetching} onRetry={retry} />}
      ListEmptyComponent={
        query.isPending ? (
          <LoadingState />
        ) : failed ? (
          <ErrorState error={query.error} onRetry={retry} />
        ) : (
          <EmptyState title={props.empty.title} body={props.empty.body} icon={props.empty.icon} />
        )
      }
      refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isRefetchError} onRefresh={retry} tintColor={colors.primary} colors={[colors.primary]} />}
      initialNumToRender={12}
      windowSize={7}
      removeClippedSubviews
    />
  );
}

export function InfiniteListScreen<T>({ query, ...props }: CommonProps<T> & { query: UseInfiniteQueryResult<InfiniteData<Page<T>>> }) {
  const { t } = useI18n();
  const { colors, contentStyle } = useListChrome();
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const retry = () => void query.refetch();
  const failed = !query.isPending && query.data === undefined;
  return (
    <FlatList
      testID={props.testID}
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={contentStyle}
      data={items}
      keyExtractor={props.keyExtractor}
      renderItem={wrapRow(props.renderItem, props.plain, colors.surface, colors.border, items.length)}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      ListHeaderComponent={<Header header={props.header} updatedAt={query.dataUpdatedAt} refreshFailed={!!query.error && !query.isFetchNextPageError} fetching={query.isFetching && !isFetchingNextPage} onRetry={retry} />}
      ListEmptyComponent={
        query.isPending ? (
          <LoadingState />
        ) : failed ? (
          <ErrorState error={query.error} onRetry={retry} />
        ) : (
          <EmptyState title={props.empty.title} body={props.empty.body} icon={props.empty.icon} />
        )
      }
      ListFooterComponent={
        isFetchingNextPage ? (
          <ActivityIndicator style={styles.footer} color={colors.primary} />
        ) : query.isFetchNextPageError ? (
          <ErrorState error={query.error} onRetry={() => void fetchNextPage()} compact />
        ) : items.length > 0 && !hasNextPage ? (
          <Text variant="caption" tone="faint" style={styles.end}>
            {t('state.endOfList')}
          </Text>
        ) : null
      }
      refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isRefetchError} onRefresh={() => void query.refetch()} tintColor={colors.primary} colors={[colors.primary]} />}
      initialNumToRender={12}
      windowSize={7}
      removeClippedSubviews
    />
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingTop: spacing.md, paddingHorizontal: spacing.lg, width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' },
  // Full-bleed so horizontally scrolling filter chips reach the screen edges; text content re-adds the inset.
  header: { gap: spacing.md, marginBottom: spacing.md, marginHorizontal: -spacing.lg },
  inset: { paddingHorizontal: spacing.lg },
  row: { borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  first: { borderTopWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  last: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  footer: { padding: spacing.lg },
  end: { textAlign: 'center', padding: spacing.lg },
});
