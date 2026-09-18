/**
 * Pure helpers for the settings screens.
 */
import type { Environment, Favorite, FavoriteType } from '@/api/contract';
import type { RegistrationResult } from '@/app-shell/notification-effects';
import type { MessageKey } from '@/i18n';

type ExpoConfigLike = { version?: string; ios?: { buildNumber?: string }; android?: { versionCode?: number } } | null | undefined;

/** The store build number of this platform: iOS `buildNumber`, Android `versionCode`, nothing elsewhere. */
export function buildNumberOf(config: ExpoConfigLike, platform: string): string | null {
  if (platform === 'ios') return config?.ios?.buildNumber ?? null;
  if (platform === 'android') return config?.android?.versionCode !== undefined ? String(config.android.versionCode) : null;
  return null;
}

/** The message explaining a push registration outcome. */
export function registrationMessage(result: RegistrationResult): MessageKey {
  if (result.ok) return 'notifications.registered';
  switch (result.reason) {
    case 'web':
      return 'notifications.webUnsupported';
    case 'not_device':
      return 'notifications.notPhysicalDevice';
    case 'denied':
      return 'notifications.permissionDenied';
    case 'no_project':
      return 'notifications.noProject';
    case 'server_unsupported':
      return 'notifications.serverUnsupported';
    default:
      return 'notifications.registerFailed';
  }
}

/** The environment in effect: the chosen one, else the production one (the server default), else the first. */
export function effectiveEnvironmentId(list: readonly Environment[], selected: string | null): string | null {
  return (list.find((e) => e.id === selected) ?? list.find((e) => e.kind === 'production') ?? list[0])?.id ?? null;
}

export type EnvironmentChoice = { action: 'none' } | { action: 'confirm' } | { action: 'select' };

/**
 * What a tap on an environment does. Switching TO production needs a second tap (or the confirm button) after the
 * warning, so nobody lands in production by accident. Re-selecting the current environment does nothing.
 */
export function chooseEnvironment(target: Environment, currentId: string | null, pendingId: string | null): EnvironmentChoice {
  if (target.id === currentId) return { action: 'none' };
  if (target.kind === 'production' && pendingId !== target.id) return { action: 'confirm' };
  return { action: 'select' };
}

export const FAVORITE_GROUP_ORDER: readonly FavoriteType[] = ['service', 'synthetic', 'environment', 'view'];

export function groupFavorites(items: readonly Favorite[]): { type: FavoriteType; items: Favorite[] }[] {
  return FAVORITE_GROUP_ORDER.map((type) => ({ type, items: items.filter((f) => f.type === type) })).filter((g) => g.items.length > 0);
}
