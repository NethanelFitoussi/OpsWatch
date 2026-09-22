CREATE TABLE `deployments` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`connection_id` text NOT NULL,
	`scope` text NOT NULL,
	`deployment_id` text NOT NULL,
	`service_id` text NOT NULL,
	`service_name` text NOT NULL,
	`cluster` text NOT NULL,
	`task_definition` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`desired_count` integer NOT NULL,
	`running_count` integer NOT NULL,
	`failed_tasks` integer NOT NULL,
	`first_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deployments_id_unique` ON `deployments` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `deployments_provider_id` ON `deployments` (`connection_id`,`scope`,`deployment_id`);--> statement-breakpoint
CREATE INDEX `deployments_env_started` ON `deployments` (`connection_id`,`scope`,`started_at`);--> statement-breakpoint
CREATE INDEX `deployments_service` ON `deployments` (`service_id`,`started_at`);