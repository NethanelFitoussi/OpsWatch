CREATE TABLE `family_snapshots` (
	`connection_id` text NOT NULL,
	`scope` text NOT NULL,
	`family` text NOT NULL,
	`status` text NOT NULL,
	`total` integer,
	`affected` integer,
	`read_at` integer NOT NULL,
	`unavailable_reason` text,
	`unavailable_code` text,
	PRIMARY KEY(`connection_id`, `scope`, `family`)
);
