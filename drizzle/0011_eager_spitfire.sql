CREATE TABLE `history_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`interval_minutes` integer DEFAULT 5 NOT NULL,
	`categories` text NOT NULL,
	`retention_days` integer DEFAULT 90 NOT NULL,
	`provider_id` text DEFAULT 'opswatch-db' NOT NULL,
	`updated_at` integer NOT NULL
);
