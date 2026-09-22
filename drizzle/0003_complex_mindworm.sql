CREATE TABLE `problem_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`problem_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`label_key` text NOT NULL,
	`values` text NOT NULL,
	`value` real,
	`unit` text,
	`at` integer NOT NULL,
	`series_ref` text,
	`href` text,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `problem_evidence_problem` ON `problem_evidence` (`problem_id`,`position`);--> statement-breakpoint
CREATE TABLE `problems` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`key` text NOT NULL,
	`connection_id` text NOT NULL,
	`scope` text NOT NULL,
	`kind` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`subject_name` text NOT NULL,
	`service_id` text,
	`source` text NOT NULL,
	`title_key` text NOT NULL,
	`values` text NOT NULL,
	`severity` text NOT NULL,
	`score` integer NOT NULL,
	`score_terms` text NOT NULL,
	`status` text NOT NULL,
	`href` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`last_evaluated_at` integer NOT NULL,
	`clear_streak` integer DEFAULT 0 NOT NULL,
	`clear_since_at` integer,
	`occurrences` integer DEFAULT 1 NOT NULL,
	`flap_count` integer DEFAULT 0 NOT NULL,
	`acknowledged_by` text,
	`acknowledged_at` integer,
	`resolved_at` integer,
	`investigation_id` text,
	`incident_id` text,
	`previous_problem_id` text,
	`fleet_problem_id` text,
	`grouped` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `problems_id_unique` ON `problems` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `problems_open_key` ON `problems` (`key`) WHERE resolved_at is null;--> statement-breakpoint
CREATE INDEX `problems_env_seq` ON `problems` (`connection_id`,`scope`,`seq`);--> statement-breakpoint
CREATE INDEX `problems_key_resolved` ON `problems` (`key`,`resolved_at`);--> statement-breakpoint
CREATE INDEX `problems_service` ON `problems` (`service_id`,`seq`);