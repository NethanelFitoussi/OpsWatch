import { View } from 'react-native';
import type { SearchResult } from '@/api/contract';
import { useI18n } from '@/i18n';
import { SeverityBadge } from '@/ui/badges';
import { Button } from '@/ui/controls';
import { Card, Divider, Row, Section } from '@/ui/layout';
import { SEARCH_GROUP_META, type SearchGroup } from './helpers';

export function SearchGroupSection({ group, onOpen }: { group: SearchGroup; onOpen: (result: SearchResult) => void }) {
  const { t } = useI18n();
  const meta = SEARCH_GROUP_META[group.key];
  return (
    <View testID={`search-group-${group.key}`}>
      <Section title={`${t(meta.label)} · ${group.items.length}`}>
        <Card padded={false}>
          {group.items.map((result, i) => (
            <View key={`${result.type}:${result.id}`}>
              {i > 0 ? <Divider /> : null}
              <Row
                title={result.title}
                subtitle={result.subtitle}
                icon={meta.icon}
                right={result.severity ? <SeverityBadge severity={result.severity} /> : undefined}
                onPress={() => onOpen(result)}
                accessibilityLabel={[t(`search.type.${result.type}`), result.severity ? t(`severity.${result.severity}`) : null, result.title, result.subtitle].filter(Boolean).join(', ')}
                testID={`search-result-${result.type}-${result.id}`}
              />
            </View>
          ))}
        </Card>
      </Section>
    </View>
  );
}

export function RecentSearches({ items, onPick, onClear }: { items: string[]; onPick: (text: string) => void; onClear: () => void }) {
  const { t } = useI18n();
  if (!items.length) return null;
  return (
    <Section
      title={t('search.recent')}
      action={<Button label={t('search.clearRecent')} accessibilityHint={t('search.clearRecentLabel')} variant="ghost" compact onPress={onClear} testID="search-clear-recent" />}
    >
      <Card padded={false}>
        {items.map((item, i) => (
          <View key={item}>
            {i > 0 ? <Divider /> : null}
            <Row title={item} icon="time-outline" onPress={() => onPick(item)} numberOfLines={1} testID={`search-recent-${i}`} />
          </View>
        ))}
      </Card>
    </Section>
  );
}
