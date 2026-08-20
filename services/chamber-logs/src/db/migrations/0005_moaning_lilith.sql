CREATE TABLE `event_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_type` text NOT NULL,
	`chamber` text NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`record_to_history` integer DEFAULT true NOT NULL,
	`history_min_priority` text,
	`history_retention_ms` integer,
	`notify` integer DEFAULT false NOT NULL,
	`notify_min_priority` text,
	`notify_title_template` text,
	`notify_body_template` text,
	`notify_url_template` text,
	`notify_dedupe_key_template` text,
	`last_fired_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_settings_event_type_unique` ON `event_settings` (`event_type`);--> statement-breakpoint
CREATE INDEX `event_settings_chamber_idx` ON `event_settings` (`chamber`);--> statement-breakpoint
DROP TABLE `log_rule_refs`;--> statement-breakpoint
DROP TABLE `log_rules`;--> statement-breakpoint
CREATE INDEX `event_history_type_idx` ON `event_history` (`type`);--> statement-breakpoint
ALTER TABLE `event_history` DROP COLUMN `rule_id`;