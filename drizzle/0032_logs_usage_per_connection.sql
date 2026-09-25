-- `logs_usage` was keyed by the UTC day alone, which made the Logs Insights budget
-- first-come-first-served across every connected AWS account. It is now keyed by day and account.
--
-- The rows that already exist were recorded before anything wrote an account down, so there is no
-- column to copy: drizzle-kit's generated form selected `connection_id` from a table that has none and
-- would have failed on every installation that has ever run an error collection.
--
-- Where the answer is knowable it is written: on an installation with exactly one connection, all of
-- that spend was that connection's. Where it is not, the rows are kept under the empty account id —
-- real spend, honestly unattributed — rather than deleted or guessed at.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_logs_usage` (
	`day` integer NOT NULL,
	`connection_id` text NOT NULL,
	`bytes_scanned` integer NOT NULL,
	`queries` integer NOT NULL,
	`stopped_at` integer,
	PRIMARY KEY(`day`, `connection_id`)
);
--> statement-breakpoint
INSERT INTO `__new_logs_usage`("day", "connection_id", "bytes_scanned", "queries", "stopped_at")
SELECT
	"day",
	CASE WHEN (SELECT count(*) FROM `connections`) = 1 THEN (SELECT "id" FROM `connections`) ELSE '' END,
	"bytes_scanned",
	"queries",
	"stopped_at"
FROM `logs_usage`;--> statement-breakpoint
DROP TABLE `logs_usage`;--> statement-breakpoint
ALTER TABLE `__new_logs_usage` RENAME TO `logs_usage`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
