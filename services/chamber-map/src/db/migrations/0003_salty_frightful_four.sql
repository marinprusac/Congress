PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`unknown_cluster_radius_meters` integer DEFAULT 150 NOT NULL,
	`min_dwell_ms` integer DEFAULT 900000 NOT NULL,
	`stopped_speed_kmh` real DEFAULT 3 NOT NULL,
	`poll_interval_ms` integer DEFAULT 120000 NOT NULL,
	`last_processed_at` integer,
	`last_poll_succeeded_at` integer,
	`last_poll_error` text
);
--> statement-breakpoint
INSERT INTO `__new_settings`("id", "unknown_cluster_radius_meters", "min_dwell_ms", "stopped_speed_kmh", "poll_interval_ms", "last_processed_at", "last_poll_succeeded_at", "last_poll_error") SELECT "id", "unknown_cluster_radius_meters", "min_dwell_ms", "stopped_speed_kmh", "poll_interval_ms", "last_processed_at", "last_poll_succeeded_at", "last_poll_error" FROM `settings`;--> statement-breakpoint
DROP TABLE `settings`;--> statement-breakpoint
ALTER TABLE `__new_settings` RENAME TO `settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `trips` ADD `label` text;