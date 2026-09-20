/**
 * What a user chose for themselves: their favourites, their locale and what they want to be told about.
 *
 * Preferences belong to the user, not to the instance: the operator's settings live elsewhere and are never mixed
 * in here, so a viewer can change these without touching anything shared.
 */
import { z } from 'zod';
import { idSchema } from './primitives';
import { notificationPreferencesSchema } from './notifications';

export const FAVORITE_TYPES = ['service', 'environment', 'synthetic', 'view'] as const;
export type FavoriteType = (typeof FAVORITE_TYPES)[number];

export const favoriteSchema = z.object({ type: z.enum(FAVORITE_TYPES), id: idSchema, label: z.string() });
export type Favorite = z.infer<typeof favoriteSchema>;

export const favoritesSchema = z.object({ items: z.array(favoriteSchema) });
export type Favorites = z.infer<typeof favoritesSchema>;

/** Every field is optional: a client sends only what it is changing, and an older server ignores what it does not know. */
export const userPreferencesSchema = z.object({
  locale: z.string().optional(),
  defaultEnvironmentId: idSchema.optional(),
  notifications: notificationPreferencesSchema.optional(),
});
export type UserPreferences = z.infer<typeof userPreferencesSchema>;
