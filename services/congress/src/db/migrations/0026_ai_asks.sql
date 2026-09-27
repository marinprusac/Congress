ALTER TABLE `ai_messages` ADD `delivered_at` integer;--> statement-breakpoint
ALTER TABLE `ai_messages` ADD `pushed_at` integer;--> statement-breakpoint
ALTER TABLE `ai_settings` ADD `max_pushes_per_day` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_settings` ADD `quiet_hours_start` integer DEFAULT 22;--> statement-breakpoint
ALTER TABLE `ai_settings` ADD `quiet_hours_end` integer DEFAULT 7;--> statement-breakpoint
ALTER TABLE `ai_settings` ADD `time_zone` text;