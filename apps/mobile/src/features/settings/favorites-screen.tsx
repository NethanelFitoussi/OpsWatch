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
import { useServices, useSynthetics } from '@/api/queries';
import { useCurrentEnvironment } from '@/features/shared/header';
import { useFeature } from '@/state/session';
import { Note } from './components';
import { favoritePresence, groupFavorites } from './helpers';

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
  const environment = useCurrentEnvironment();
  // Only to tell a favorite that is still there from one that is not: both lists are already cached for the app.
  const services = useServices();
  const synthetics = useSynthetics();
  const known = {
    services: useFeature('services') ? services.data : undefined,
    synthetics: useFeature('synthetics') ? synthetics.data : undefined,
  };

  const onOpen = (favorite: Favorite, presence: string): (() => void) | undefined => {
    if (presence === 'missing') return undefined;
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
              {group.items.map((favorite, i) => {
                const presence = favoritePresence(favorite, known);
                const subtitle =
                  favorite.type === 'environment' && settings.environmentId === favorite.id
                    ? t('settings.favoritesCurrentEnv')
                    : presence === 'missing'
                      ? t('settings.favoriteMissing', { environment: environment?.name ?? '' })
                      : undefined;
                return (
                <View key={`${favorite.type}:${favorite.id}`}>
                  {i > 0 ? <Divider /> : null}
                  <Row
                    title={favorite.label}
                    subtitle={subtitle}
                    icon={presence === 'missing' ? 'help-circle-outline' : ICONS[favorite.type]}
                    iconColor={presence === 'missing' ? colors.textFaint : undefined}
                    onPress={onOpen(favorite, presence)}
                    chevron={presence !== 'missing' && (favorite.type === 'service' || favorite.type === 'synthetic')}
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
                );
              })}
            </Card>
          </Section>
        ))
      )}
    </ScrollScreen>
  );
}
