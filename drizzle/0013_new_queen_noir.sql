CREATE TABLE `integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`credential_ciphertext` text,
	`status` text DEFAULT 'untested' NOT NULL,
	`last_tested_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integrations_kind_name` ON `integrations` (`kind`,`name`);--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`integration_id` text,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`default_branch` text DEFAULT 'main' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`integration_id`) REFERENCES `integrations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repositories_owner_name` ON `repositories` (`owner`,`name`);--> statement-breakpoint
CREATE TABLE `service_repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`scope` text NOT NULL,
	`service_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`path_prefix` text,
	`source` text DEFAULT 'declared' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_repositories_service` ON `service_repositories` (`connection_id`,`scope`,`service_id`);