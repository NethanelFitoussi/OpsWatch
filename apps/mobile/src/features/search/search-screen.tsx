/**
 * Global search. Results come from the server's search endpoint (never persisted); only the typed words are kept, as
 * recent searches, when the user submits a search or opens a result.
 */
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import type { SearchResult } from '@/api/contract';
import { useSearch } from '@/api/queries';
import { useOpenRef } from '@/features/shared/navigation';
import { useI18n } from '@/i18n';
import { useFeature } from '@/state/session';
import { addRecentSearch, useSettings } from '@/state/settings';
import { TextField } from '@/ui/controls';
import { Card, Row } from '@/ui/layout';
import { ScrollScreen } from '@/ui/screen';
import { EmptyState, ErrorState } from '@/ui/states';
import { Text } from '@/ui/text';
import { useTheme } from '@/ui/theme-provider';
import { RecentSearches, SearchGroupSection } from './components';
import { groupSearchResults, isSearchable, SEARCH_DEBOUNCE_MS } from './helpers';
import { useDebouncedValue } from './use-debounced-value';

export function SearchScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const openRef = useOpenRef();
  const aiEnabled = useFeature('ai');
  const { settings, update } = useSettings();
  const [text, setText] = useState('');
  const debounced = useDebouncedValue(text, SEARCH_DEBOUNCE_MS);
  const query = useSearch(debounced);
  const searchable = isSearchable(text);
  const settled = searchable && debounced.trim() === text.trim();

  const remember = (value: string) => update((current) => ({ recentSearches: addRecentSearch(current.recentSearches, value) }));
  const open = (result: SearchResult) => {
    remember(text);
    openRef(result);
  };

  const groups = query.data ? groupSearchResults(query.data) : [];

  return (
    <ScrollScreen testID="search-screen">
      <TextField
        label={t('search.label')}
        placeholder={t('search.placeholder')}
        value={text}
        onChangeText={setText}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
        icon="search"
        onSubmitEditing={() => {
          if (searchable) remember(text);
        }}
        testID="search-input"
      />

      {searchable && aiEnabled ? (
        <Card padded={false}>
          <Row
            title={t('search.askAi', { text: text.trim() })}
            icon="sparkles-outline"
            iconColor={colors.primary}
            accessibilityHint={t('search.askAiHint')}
            onPress={() => router.push({ pathname: '/ask', params: { question: text.trim() } } as unknown as Href)}
            testID="search-ask-ai"
          />
        </Card>
      ) : null}

      {!searchable ? (
        <>
          {text.trim().length > 0 ? (
            <Text variant="small" tone="muted">
              {t('search.minChars')}
            </Text>
          ) : null}
          <RecentSearches items={settings.recentSearches} onPick={setText} onClear={() => update({ recentSearches: [] })} />
          {settings.recentSearches.length === 0 ? (
            <EmptyState
              icon="search-outline"
              title={t('search.emptyTitle')}
              body={t('search.emptyBody')}
              action={
                <Text variant="small" tone="faint" style={{ textAlign: 'center' }}>
                  {t('search.noRecent')}
                </Text>
              }
            />
          ) : null}
        </>
      ) : query.isPending || !settled ? (
        <View accessibilityRole="progressbar" accessibilityLabel={t('state.loading')}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : query.data === undefined ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : groups.length === 0 ? (
        <EmptyState icon="search-outline" title={t('search.noResultsTitle')} body={t('search.noResultsBody', { text: debounced.trim() })} />
      ) : (
        groups.map((group) => <SearchGroupSection key={group.key} group={group} onOpen={open} />)
      )}
    </ScrollScreen>
  );
}
