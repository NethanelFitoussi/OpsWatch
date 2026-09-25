-- `connections` gains a provider, and `aws_account_id` becomes nullable: a Google Cloud connection has
-- no AWS account, and a sentinel in a NOT NULL column would be a lie that every reader has to know about.
--
-- Every connection that exists is an AWS one, so the provider is written as 'aws' and the Google columns
-- as NULL. drizzle-kit generated this as a straight column-for-column copy, selecting `provider` and the
-- five `gcp_*` columns **out of the table that does not have them yet** — it would have failed on the
-- first start of every installation.
--
-- The rebuild drops and renames, and `connections` is the parent of nineteen cascading children, so
-- foreign keys must genuinely be off while it happens: with them on, `DROP TABLE` would take every
-- problem, alert, error group and log source with it. `migration-connection-provider.test.ts` runs this
-- through the same migrator the application uses and checks the children are still there afterwards.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`provider` text DEFAULT 'aws' NOT NULL,
	`method` text NOT NULL,
	`aws_account_id` text,
	`regions` text NOT NULL,
	`role_arn` text,
	`external_id` text,
	`template_version` integer,
	`access_key_ciphertext` text,
	`gcp_project_id` text,
	`gcp_project_number` text,
	`gcp_pool_id` text,
	`gcp_provider_id` text,
	`gcp_service_account` text,
	`status` text NOT NULL,
	`last_test` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_connections`("id", "name", "provider", "method", "aws_account_id", "regions", "role_arn", "external_id", "template_version", "access_key_ciphertext", "gcp_project_id", "gcp_project_number", "gcp_pool_id", "gcp_provider_id", "gcp_service_account", "status", "last_test", "created_at", "updated_at")
SELECT "id", "name", 'aws', "method", "aws_account_id", "regions", "role_arn", "external_id", "template_version", "access_key_ciphertext", NULL, NULL, NULL, NULL, NULL, "status", "last_test", "created_at", "updated_at" FROM `connections`;--> statement-breakpoint
DROP TABLE `connections`;--> statement-breakpoint
ALTER TABLE `__new_connections` RENAME TO `connections`;--> statement-breakpoint
PRAGMA foreign_keys=ON;