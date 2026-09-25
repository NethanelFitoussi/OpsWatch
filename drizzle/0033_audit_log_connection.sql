ALTER TABLE `audit_log` ADD `connection_id` text;--> statement-breakpoint
CREATE INDEX `audit_log_connection` ON `audit_log` (`connection_id`,`at`);