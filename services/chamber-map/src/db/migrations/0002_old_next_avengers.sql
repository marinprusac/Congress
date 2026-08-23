ALTER TABLE `settings` ADD `stopped_speed_kmh` real DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `poll_interval_ms` integer DEFAULT 120000 NOT NULL;