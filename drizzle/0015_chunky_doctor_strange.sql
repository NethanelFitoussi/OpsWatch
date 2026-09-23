CREATE TABLE `alert_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`scope` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`condition` text NOT NULL,
	`min_severity` text DEFAULT 'critical' NOT NULL,
	`kinds` text NOT NULL,
	`channels` text NOT NULL,
	`cooldown_seconds` integer DEFAULT 1800 NOT NULL,
	`origin` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alert_rules_name` ON `alert_rules` (`connection_id`,`scope`,`name`);--> statement-breakpoint
CREATE TABLE `alerts` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`connection_id` text NOT NULL,
	`scope` text NOT NULL,
	`rule_id` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`problem_id` text,
	`title_key` text NOT NULL,
	`values` text NOT NULL,
	`severity` text NOT NULL,
	`status` text NOT NULL,
	`first_fired_at` integer NOT NULL,
	`last_fired_at` integer NOT NULL,
	`suppressed_count` integer DEFAULT 0 NOT NULL,
	`acknowledged_at` integer,
	`acknowledged_by` text,
	`resolved_at` integer,
	FOREIGN KEY (`rule_id`) REFERENCES `alert_rules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alerts_id_unique` ON `alerts` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `alerts_open_dedupe` ON `alerts` (`dedupe_key`) WHERE resolved_at is null;--> statement-breakpoint
CREATE INDEX `alerts_env_seq` ON `alerts` (`connection_id`,`scope`,`seq`);