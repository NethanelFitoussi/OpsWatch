CREATE TABLE `error_groups` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`fingerprint_version` integer NOT NULL,
	`connection_id` text NOT NULL,
	`scope` text NOT NULL,
	`service_id` text,
	`log_source_id` text NOT NULL,
	`exception_type` text,
	`sample_message` text NOT NULL,
	`normalized_message` text NOT NULL,
	`top_frames` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`status` text NOT NULL,
	`status_since` integer NOT NULL,
	`last_deployment_id` text,
	`problem_id` text,
	`muted_reason` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `error_groups_id_unique` ON `error_groups` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `error_groups_fingerprint` ON `error_groups` (`connection_id`,`scope`,`fingerprint`,`fingerprint_version`);--> statement-breakpoint
CREATE INDEX `error_groups_env_seq` ON `error_groups` (`connection_id`,`scope`,`seq`);--> statement-breakpoint
CREATE INDEX `error_groups_last_seen` ON `error_groups` (`connection_id`,`scope`,`last_seen_at`);--> statement-breakpoint
CREATE TABLE `error_occurrences` (
	`group_id` text NOT NULL,
	`hour_at` integer NOT NULL,
	`count` integer NOT NULL,
	`instances` integer,
	PRIMARY KEY(`group_id`, `hour_at`),
	FOREIGN KEY (`group_id`) REFERENCES `error_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `log_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`scope` text NOT NULL,
	`log_group` text NOT NULL,
	`service_id` text,
	`enabled` integer DEFAULT false NOT NULL,
	`format` text NOT NULL,
	`field_map` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `log_sources_group` ON `log_sources` (`connection_id`,`scope`,`log_group`);--> statement-breakpoint
CREATE TABLE `user_marks` (
	`admin_user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`connection_id` text NOT NULL,
	`scope` text NOT NULL,
	`seen_at` integer NOT NULL,
	PRIMARY KEY(`admin_user_id`, `kind`, `connection_id`, `scope`),
	FOREIGN KEY (`admin_user_id`) REFERENCES `admin_user`(`id`) ON UPDATE no action ON DELETE cascade
);
