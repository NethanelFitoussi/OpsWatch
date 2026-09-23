CREATE TABLE `deployment_commits` (
	`deployment_id` text NOT NULL,
	`sha` text NOT NULL,
	`repository` text NOT NULL,
	`message` text NOT NULL,
	`author` text,
	`at` integer NOT NULL,
	`files` text NOT NULL,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`deployment_id`, `sha`)
);
--> statement-breakpoint
CREATE INDEX `deployment_commits_at` ON `deployment_commits` (`deployment_id`,`at`);