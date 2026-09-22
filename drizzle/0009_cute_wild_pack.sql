CREATE TABLE `logs_usage` (
	`day` integer PRIMARY KEY NOT NULL,
	`bytes_scanned` integer NOT NULL,
	`queries` integer NOT NULL,
	`stopped_at` integer
);
