CREATE TABLE `cloudflare_daily` (
	`zone_id` text NOT NULL,
	`date` text NOT NULL,
	`requests` integer NOT NULL,
	`cached_requests` integer NOT NULL,
	`bytes` integer NOT NULL,
	`cached_bytes` integer NOT NULL,
	`threats` integer NOT NULL,
	`uniques` integer,
	`client_errors` integer NOT NULL,
	`server_errors` integer NOT NULL,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`zone_id`, `date`)
);
