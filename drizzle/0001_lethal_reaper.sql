CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`refresh_interval_ms` integer NOT NULL,
	`default_range` text NOT NULL,
	`updated_at` integer NOT NULL
);
