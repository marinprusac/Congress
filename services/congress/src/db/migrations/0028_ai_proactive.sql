CREATE TABLE `ai_event_buffer` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chamber` text NOT NULL,
	`type` text NOT NULL,
	`payload_json` text,
	`actor` text,
	`occurred_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_event_buffer_occurred_at_idx` ON `ai_event_buffer` (`occurred_at`);--> statement-breakpoint
ALTER TABLE `ai_settings` ADD `proactive_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_settings` ADD `proactive_budget_usd` real DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_settings` ADD `gate_model` text DEFAULT 'claude-haiku-4-5-20251001' NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_settings` ADD `gate_sensitivity` text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_settings` ADD `heartbeat_hours` real DEFAULT 4 NOT NULL;