CREATE TABLE `notify_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`destination_id` text NOT NULL,
	`alert_id` text NOT NULL,
	`payload` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`next_attempt_at` integer,
	`delivered_at` integer,
	FOREIGN KEY (`destination_id`) REFERENCES `notify_destinations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notify_destinations` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`secret_ciphertext` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`last_result` text,
	`last_attempt_at` integer,
	`last_error` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL
);
