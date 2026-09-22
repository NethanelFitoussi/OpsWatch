CREATE TABLE `collector_lock` (
	`id` integer PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`heartbeat_at` integer NOT NULL
);
