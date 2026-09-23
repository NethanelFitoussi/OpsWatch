CREATE TABLE `metric_baselines` (
	`connection_id` text NOT NULL,
	`scope` text NOT NULL,
	`subject_id` text NOT NULL,
	`metric` text NOT NULL,
	`bucket` integer NOT NULL,
	`median` real NOT NULL,
	`mad` real NOT NULL,
	`samples` integer NOT NULL,
	`computed_at` integer NOT NULL,
	PRIMARY KEY(`connection_id`, `scope`, `subject_id`, `metric`, `bucket`)
);
