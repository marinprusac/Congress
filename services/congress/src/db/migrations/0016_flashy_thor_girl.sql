DROP TABLE `events`;--> statement-breakpoint
ALTER TABLE `chambers` ADD `subscriptions_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` DROP COLUMN `event_retention_ms`;