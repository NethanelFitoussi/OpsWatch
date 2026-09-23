CREATE TABLE `slo_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`scope` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`objective` real NOT NULL,
	`latency_threshold_ms` integer,
	`window_days` integer DEFAULT 30 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slo_definitions_name` ON `slo_definitions` (`connection_id`,`scope`,`name`);