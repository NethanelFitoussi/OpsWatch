import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
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

export type ConnectionRow = typeof connections.$inferSelect;
