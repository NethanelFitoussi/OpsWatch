CREATE TABLE `user_preferences` (
	`admin_user_id` integer PRIMARY KEY NOT NULL,
	`locale` text,
	`default_environment_id` text,
	`min_severity` text DEFAULT 'critical' NOT NULL,
	`categories` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`admin_user_id`) REFERENCES `admin_user`(`id`) ON UPDATE no action ON DELETE cascade
);
