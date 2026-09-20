import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { TokenAudience } from '@opswatch/contract';
import {
  CONNECTION_METHODS,
  CONNECTION_STATUSES,
  type PermissionTestResult,
} from '../connections/types';

export const adminUser = sqliteTable('admin_user', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  adminUserId: integer('admin_user_id')
    .notNull()
    .references(() => adminUser.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  /**
   * Which kind of client this session was minted for: `web` for the browser cookie, `api` for a bearer token. A
   * session is only accepted where its own audience belongs, so neither can be replayed as the other. Rows written
   * before the API existed are browser sessions, which is what the default says.
   */
  audience: text('audience').notNull().default('web').$type<TokenAudience>(),
  /** Null until the session is presented a second time. `GET /me/sessions` shows it, so a stale device stands out. */
  lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
});

export const connections = sqliteTable('connections', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  method: text('method', { enum: CONNECTION_METHODS }).notNull(),
  awsAccountId: text('aws_account_id').notNull(),
  regions: text('regions', { mode: 'json' }).$type<string[]>().notNull(),
  roleArn: text('role_arn'),
  externalId: text('external_id'),
  templateVersion: integer('template_version'),
  accessKeyCiphertext: text('access_key_ciphertext'),
  status: text('status', { enum: CONNECTION_STATUSES }).notNull(),
  lastTest: text('last_test', { mode: 'json' }).$type<PermissionTestResult>(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * The instance's own settings. One admin, so one row, always `SETTINGS_ROW_ID`: no key column and no
 * per-user fan-out. Added on its own, next to `connections`, which this table never touches.
 */
export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey(),
  refreshIntervalMs: integer('refresh_interval_ms').notNull(),
  defaultRange: text('default_range').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export type ConnectionRow = typeof connections.$inferSelect;
