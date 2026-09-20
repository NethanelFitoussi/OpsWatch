/**
 * Screen containers. `QueryScreen` handles the four states every data screen has (loading, error without data,
 * data, refreshing) and shows freshness, so individual screens only render their content.
 */
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ErrorState, Freshness, LoadingState } from './states';
import { spacing } from './theme';
import { useTheme } from './theme-provider';

/** Content width cap so tablets get readable columns instead of stretched rows. */
export const MAX_CONTENT_WIDTH = 760;

export function ScrollScreen({ children, refreshing, onRefresh, testID }: { children: ReactNode; refreshing?: boolean; onRefresh?: () => void; testID?: string }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} /> : undefined}
      keyboardShouldPersistTaps="handled"
      testID={testID}
    >
      <View style={styles.inner}>{children}</View>
    </ScrollView>
  );
}

type QueryScreenProps<T> = {
  query: Pick<UseQueryResult<T>, 'data' | 'error' | 'isPending' | 'isRefetching' | 'isRefetchError' | 'dataUpdatedAt' | 'refetch' | 'isFetching'>;
  children: (data: T) => ReactNode;
  testID?: string;
  header?: ReactNode;
};

export function QueryScreen<T>({ query, children, testID, header }: QueryScreenProps<T>) {
  const { colors } = useTheme();
  if (query.isPending) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {header}
        <LoadingState />
      </View>
    );
  }
  if (query.data === undefined) {
    return (
      <ScrollScreen onRefresh={() => void query.refetch()} testID={testID}>
        {header}
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </ScrollScreen>
    );
  }
  return (
    <ScrollScreen refreshing={query.isRefetching && !query.isRefetchError} onRefresh={() => void query.refetch()} testID={testID}>
      {header}
      <Freshness updatedAt={query.dataUpdatedAt} refreshFailed={!!query.error} fetching={query.isFetching} onRetry={() => void query.refetch()} />
      {children(query.data)}
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingTop: spacing.md },
  inner: { width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', paddingHorizontal: spacing.lg, gap: spacing.lg },
});
