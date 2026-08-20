PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_event_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_type` text NOT NULL,
	`chamber` text NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`record_to_history` integer DEFAULT true NOT NULL,
	`history_min_priority` text DEFAULT 'low' NOT NULL,
	`history_retention_ms` integer,
	`notify` integer DEFAULT false NOT NULL,
	`notify_min_priority` text DEFAULT 'low' NOT NULL,
	`notify_title_template` text,
	`notify_body_template` text,
	`notify_url_template` text,
	`notify_dedupe_key_template` text,
	`last_fired_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_event_settings`("id", "event_type", "chamber", "label", "description", "record_to_history", "history_min_priority", "history_retention_ms", "notify", "notify_min_priority", "notify_title_template", "notify_body_template", "notify_url_template", "notify_dedupe_key_template", "last_fired_at", "created_at", "updated_at") SELECT "id", "event_type", "chamber", "label", "description", "record_to_history", "history_min_priority", "history_retention_ms", "notify", "notify_min_priority", "notify_title_template", "notify_body_template", "notify_url_template", "notify_dedupe_key_template", "last_fired_at", "created_at", "updated_at" FROM `event_settings`;--> statement-breakpoint
DROP TABLE `event_settings`;--> statement-breakpoint
ALTER TABLE `__new_event_settings` RENAME TO `event_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `event_settings_event_type_unique` ON `event_settings` (`event_type`);--> statement-breakpoint
CREATE INDEX `event_settings_chamber_idx` ON `event_settings` (`chamber`);