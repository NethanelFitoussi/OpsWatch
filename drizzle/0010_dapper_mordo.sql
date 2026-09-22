CREATE TABLE `history_points` (
	`category` text NOT NULL,
	`connection_id` text NOT NULL,
	`scope` text NOT NULL,
	`subject_id` text NOT NULL,
	`metric` text NOT NULL,
	`resolution` text NOT NULL,
	`interval_start` integer NOT NULL,
	`value` real,
	`samples` integer NOT NULL,
	PRIMARY KEY(`category`, `connection_id`, `scope`, `subject_id`, `metric`, `resolution`, `interval_start`)
);
--> statement-breakpoint
CREATE INDEX `history_points_range` ON `history_points` (`connection_id`,`scope`,`subject_id`,`metric`,`resolution`,`interval_start`);--> statement-breakpoint
CREATE TABLE `history_watermarks` (
	`category` text NOT NULL,
	`connection_id` text NOT NULL,
	`scope` text NOT NULL,
	`subject_id` text NOT NULL,
	`metric` text NOT NULL,
	`resolution` text NOT NULL,
	`complete_to` integer NOT NULL,
	PRIMARY KEY(`category`, `connection_id`, `scope`, `subject_id`, `metric`, `resolution`)
);
