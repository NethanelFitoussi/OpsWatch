-- The collection stack moves out of `aws_collection`, which held one per account, into a row per
-- region. A subscription filter can only target a Lambda in its own region, so an account reading
-- three regions needs three forwarders.
--
-- The existing stack is carried across **before** the columns go. drizzle-kit's generated form dropped
-- them first, which on any installation with a forwarder installed would have thrown away the stack
-- name, the stack id and the ARN — leaving OpsWatch unable to name the stack it asks the operator to
-- delete, and unable to forward anything until they installed it again.
--
-- It lands under the connection's first region, which is the only region it could have been forwarding
-- from: `startForwarding` read one `forwarder_arn` for the whole account and the page said as much.
-- That is a fact being written down, not a guess.
CREATE TABLE `aws_collection_stacks` (
	`connection_id` text NOT NULL,
	`region` text NOT NULL,
	`stack_state` text DEFAULT 'absent' NOT NULL,
	`stack_name` text,
	`stack_id` text,
	`forwarder_arn` text,
	`forwarder_version` text,
	`verified_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`connection_id`, `region`),
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `aws_collection_stacks`
	("connection_id", "region", "stack_state", "stack_name", "stack_id", "forwarder_arn", "forwarder_version", "verified_at", "created_at", "updated_at")
SELECT
	c."connection_id",
	json_extract(n."regions", '$[0]'),
	c."stack_state",
	c."stack_name",
	c."stack_id",
	c."forwarder_arn",
	c."forwarder_version",
	c."verified_at",
	c."created_at",
	c."updated_at"
FROM `aws_collection` c
JOIN `connections` n ON n."id" = c."connection_id"
-- Only a stack there is something to say about. An account that never installed one starts with no
-- row in any region, which is what `absent` means and is cheaper than a row saying nothing.
WHERE c."stack_state" <> 'absent' AND json_extract(n."regions", '$[0]') IS NOT NULL;--> statement-breakpoint
ALTER TABLE `aws_collection` DROP COLUMN `stack_state`;--> statement-breakpoint
ALTER TABLE `aws_collection` DROP COLUMN `stack_name`;--> statement-breakpoint
ALTER TABLE `aws_collection` DROP COLUMN `stack_id`;--> statement-breakpoint
ALTER TABLE `aws_collection` DROP COLUMN `forwarder_arn`;--> statement-breakpoint
ALTER TABLE `aws_collection` DROP COLUMN `forwarder_version`;--> statement-breakpoint
ALTER TABLE `aws_collection` DROP COLUMN `verified_at`;
