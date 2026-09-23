CREATE TABLE `synthetic_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`scope` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`method` text DEFAULT 'GET' NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`assertions` text NOT NULL,
	`secret_headers_ciphertext` text,
	`latency_threshold_ms` integer,
	`interval_minutes` integer DEFAULT 5 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `synthetic_checks_name` ON `synthetic_checks` (`connection_id`,`scope`,`name`);--> statement-breakpoint
CREATE TABLE `synthetic_runs` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`check_id` text NOT NULL,
	`at` integer NOT NULL,
	`ok` integer NOT NULL,
	`status` integer,
	`total_ms` integer,
	`dns_ms` integer,
	`tls_ms` integer,
	`ttfb_ms` integer,
	`body_bytes` integer,
	`certificate_expires_at` integer,
	`failure_reason` text,
	`assertion_results` text NOT NULL,
	FOREIGN KEY (`check_id`) REFERENCES `synthetic_checks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `synthetic_runs_id_unique` ON `synthetic_runs` (`id`);--> statement-breakpoint
CREATE INDEX `synthetic_runs_check_at` ON `synthetic_runs` (`check_id`,`at`);