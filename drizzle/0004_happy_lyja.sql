CREATE TABLE `collector_runs` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`job` text NOT NULL,
	`connection_id` text,
	`scope` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`covered` integer,
	`total` integer,
	`truncated` integer DEFAULT false NOT NULL,
	`error_code` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collector_runs_id_unique` ON `collector_runs` (`id`);--> statement-breakpoint
CREATE INDEX `collector_runs_job` ON `collector_runs` (`job`,`started_at`);--> statement-breakpoint
CREATE TABLE `events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`at` integer NOT NULL,
	`connection_id` text,
	`scope` text,
	`kind` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`service_id` text,
	`severity` text,
	`source` text NOT NULL,
	`payload` text NOT NULL,
	`dedupe_key` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_id_unique` ON `events` (`id`);--> statement-breakpoint
CREATE INDEX `events_at` ON `events` (`at`);--> statement-breakpoint
CREATE INDEX `events_service_at` ON `events` (`service_id`,`at`);--> statement-breakpoint
CREATE INDEX `events_subject_at` ON `events` (`subject_id`,`at`);--> statement-breakpoint
CREATE UNIQUE INDEX `events_dedupe` ON `events` (`dedupe_key`) WHERE dedupe_key is not null;