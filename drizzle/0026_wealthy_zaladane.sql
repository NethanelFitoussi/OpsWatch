CREATE TABLE `saved_log_searches` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_user_id` integer NOT NULL,
	`connection_id` text NOT NULL,
	`scope` text NOT NULL,
	`name` text NOT NULL,
	`search_text` text NOT NULL,
	`level` text,
	`limit_rows` integer NOT NULL,
	`range` text NOT NULL,
	`log_groups` text NOT NULL,
	`query` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`admin_user_id`) REFERENCES `admin_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saved_log_searches_name` ON `saved_log_searches` (`admin_user_id`,`connection_id`,`scope`,`name`);--> statement-breakpoint
CREATE INDEX `saved_log_searches_owner` ON `saved_log_searches` (`admin_user_id`,`connection_id`,`scope`);