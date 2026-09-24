CREATE TABLE `digest_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`day_of_week` integer DEFAULT 1 NOT NULL,
	`hour_utc` integer DEFAULT 8 NOT NULL,
	`last_sent_at` integer,
	`updated_at` integer NOT NULL
);
