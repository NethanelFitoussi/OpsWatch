/**
 * Favorites: grouped by type, opened with a tap, removed with an explicit button (no hidden swipe gesture).
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';
import type { Favorite } from '@/api/contract';
import { useFavorites } from '@/features/shared/components';
import { useOpenRef } from '@/features/shared/navigation';
import { useI18n } from '@/i18n';
import { useSettings } from '@/state/settings';
import { Card, Divider, Row, Section, type IconName } from '@/ui/layout';
import { ScrollScreen } from '@/ui/screen';
import { EmptyState } from '@/ui/states';
import { useTheme } from '@/ui/theme-provider';
import { Note } from './components';
import { groupFavorites } from './helpers';

const ICONS: Record<Favorite['type'], IconName> = {
  service: 'layers-outline',
  synthetic: 'globe-outline',
  environment: 'flask-outline',
  view: 'bookmark-outline',
};

export function FavoritesScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const openRef = useOpenRef();
  const { settings, update } = useSettings();
  const { items, toggle, serverSide } = useFavorites();
  const groups = groupFavorites(items);

  const onOpen = (favorite: Favorite): (() => void) | undefined => {
    const { type, id } = favorite;
    if (type === 'service' || type === 'synthetic') return () => openRef({ type, id });
    if (favorite.type === 'environment') return () => update({ environmentId: favorite.id });
    return undefined;
  };

  return (
    <ScrollScreen testID="favorites-screen">
      <Note testID="favorites-storage">{serverSide ? t('settings.favoritesServer') : t('settings.favoritesLocal')}</Note>
      {groups.length === 0 ? (
        <EmptyState icon="star-outline" title={t('settings.favorites')} body={t('settings.favoritesEmpty')} />
      ) : (
        groups.map((group) => (
          <Section key={group.type} title={t(`settings.favorites.type.${group.type}`)}>
            <Card padded={false}>
              {group.items.map((favorite, i) => (
                <View key={`${favorite.type}:${favorite.id}`}>
                  {i > 0 ? <Divider /> : null}
                  <Row
                    title={favorite.label}
                    subtitle={favorite.type === 'environment' && settings.environmentId === favorite.id ? t('settings.favoritesCurrentEnv') : undefined}
                    icon={ICONS[favorite.type]}
                    onPress={onOpen(favorite)}
                    chevron={favorite.type === 'service' || favorite.type === 'synthetic'}
                    testID={`favorite-${favorite.type}-${favorite.id}`}
                    right={
                      <Pressable
                        onPress={() => toggle(favorite)}
                        accessibilityRole="button"
                        accessibilityLabel={t('settings.favoritesRemove', { label: favorite.label })}
                        hitSlop={8}
                        style={{ padding: 10 }}
                        testID={`favorite-remove-${favorite.type}-${favorite.id}`}
                      >
                        <Ionicons name="trash-outline" size={20} color={colors.critical} />
                      </Pressable>
                    }
                  />
                </View>
              ))}
            </Card>
          </Section>
        ))
      )}
    </ScrollScreen>
  );
}
