CREATE TABLE `install_rule_offers` (
	`connection_id` text NOT NULL,
	`scope` text NOT NULL,
	`name` text NOT NULL,
	`offered_at` integer NOT NULL,
	PRIMARY KEY(`connection_id`, `scope`, `name`)
);
