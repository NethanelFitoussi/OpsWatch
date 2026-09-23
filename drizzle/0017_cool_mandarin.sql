CREATE TABLE `audit_log` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`at` integer NOT NULL,
	`actor_user_id` integer,
	`actor_kind` text NOT NULL,
	`action` text NOT NULL,
	`subject_type` text,
	`subject_id` text,
	`result` text NOT NULL,
	`ip` text,
	`user_agent_hash` text,
	`details` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audit_log_id_unique` ON `audit_log` (`id`);--> statement-breakpoint
CREATE INDEX `audit_log_at` ON `audit_log` (`at`);--> statement-breakpoint
CREATE INDEX `audit_log_action` ON `audit_log` (`action`,`at`);