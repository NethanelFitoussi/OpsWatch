CREATE TABLE `incident_timeline` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`incident_id` text NOT NULL,
	`at` integer NOT NULL,
	`kind` text NOT NULL,
	`event_id` text,
	`actor_id` text,
	`message_key` text,
	`values` text NOT NULL,
	`note` text,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `incident_timeline_id_unique` ON `incident_timeline` (`id`);--> statement-breakpoint
CREATE INDEX `incident_timeline_incident` ON `incident_timeline` (`incident_id`,`at`);--> statement-breakpoint
CREATE TABLE `incidents` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`connection_id` text NOT NULL,
	`scope` text NOT NULL,
	`title_key` text NOT NULL,
	`values` text NOT NULL,
	`status` text NOT NULL,
	`severity` text NOT NULL,
	`started_at` integer NOT NULL,
	`resolved_at` integer,
	`service_ids` text NOT NULL,
	`origin` text NOT NULL,
	`dismissed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `incidents_id_unique` ON `incidents` (`id`);--> statement-breakpoint
CREATE INDEX `incidents_env_seq` ON `incidents` (`connection_id`,`scope`,`seq`);