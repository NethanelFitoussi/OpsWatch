CREATE TABLE `host_samples` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_id` text NOT NULL,
	`at` integer NOT NULL,
	`cpu_percent` real,
	`memory_used_bytes` integer,
	`memory_total_bytes` integer,
	`load_1` real,
	`load_5` real,
	`load_15` real,
	`uptime_seconds` integer,
	`disks` text NOT NULL,
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `host_samples_host_at` ON `host_samples` (`host_id`,`at`);--> statement-breakpoint
CREATE TABLE `hosts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`secret_ciphertext` text NOT NULL,
	`machine_id` text,
	`hostname` text,
	`os` text,
	`kernel` text,
	`arch` text,
	`cloud` text,
	`cloud_instance_id` text,
	`connection_id` text,
	`agent_version` text,
	`enrolled_at` integer,
	`last_seen_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hosts_machine_id` ON `hosts` (`machine_id`);--> statement-breakpoint
CREATE INDEX `hosts_connection` ON `hosts` (`connection_id`);