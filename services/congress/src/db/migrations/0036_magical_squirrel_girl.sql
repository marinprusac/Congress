CREATE TABLE `ai_link_queue` (
	`key` text PRIMARY KEY NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`queued_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `ai_settings` ADD `light_model` text DEFAULT 'claude-haiku-5-5' NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_settings` ADD `linker_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_settings` ADD `linker_interval_minutes` integer DEFAULT 15 NOT NULL;--> statement-breakpoint
UPDATE `ai_settings` SET `heartbeat_hours` = 1 WHERE `heartbeat_hours` = 4;
