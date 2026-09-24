CREATE TABLE `aws_collection` (
	`connection_id` text PRIMARY KEY NOT NULL,
	`managed` integer DEFAULT false NOT NULL,
	`realtime_logs` integer DEFAULT false NOT NULL,
	`persist_logs` integer DEFAULT false NOT NULL,
	`retention_hours` integer DEFAULT 24 NOT NULL,
	`ingest_secret_ciphertext` text,
	`secret_rotated_at` integer,
	`stack_state` text DEFAULT 'absent' NOT NULL,
	`stack_name` text,
	`stack_id` text,
	`forwarder_arn` text,
	`forwarder_version` text,
	`verified_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `aws_forwarded_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`region` text NOT NULL,
	`log_group` text NOT NULL,
	`filter_name` text NOT NULL,
	`state` text NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `aws_forwarded_groups_key` ON `aws_forwarded_groups` (`connection_id`,`region`,`log_group`);--> statement-breakpoint
CREATE INDEX `aws_forwarded_groups_owner` ON `aws_forwarded_groups` (`connection_id`,`region`);--> statement-breakpoint
CREATE TABLE `ingest_events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`connection_id` text NOT NULL,
	`region` text NOT NULL,
	`source` text NOT NULL,
	`log_group` text NOT NULL,
	`log_stream` text NOT NULL,
	`at` integer NOT NULL,
	`message` text NOT NULL,
	`received_at` integer NOT NULL,
	`processed_at` integer,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingest_events_id_unique` ON `ingest_events` (`id`);--> statement-breakpoint
CREATE INDEX `ingest_events_queue` ON `ingest_events` (`processed_at`,`seq`);--> statement-breakpoint
CREATE INDEX `ingest_events_sweep` ON `ingest_events` (`connection_id`,`processed_at`);--> statement-breakpoint
CREATE TABLE `ingest_stats` (
	`connection_id` text NOT NULL,
	`region` text NOT NULL,
	`minute` integer NOT NULL,
	`events` integer DEFAULT 0 NOT NULL,
	`bytes` integer DEFAULT 0 NOT NULL,
	`rejected` integer DEFAULT 0 NOT NULL,
	`duplicates` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`connection_id`, `region`, `minute`),
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
