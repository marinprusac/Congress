CREATE TABLE `places` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`radius_meters` integer DEFAULT 100 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `positions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`traccar_position_id` integer NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`speed_knots` real NOT NULL,
	`fix_time` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `positions_traccar_id_idx` ON `positions` (`traccar_position_id`);--> statement-breakpoint
CREATE INDEX `positions_fix_time_idx` ON `positions` (`fix_time`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`traccar_url` text,
	`traccar_token` text,
	`traccar_device_id` integer,
	`unknown_cluster_radius_meters` integer DEFAULT 150 NOT NULL,
	`min_dwell_ms` integer DEFAULT 900000 NOT NULL,
	`stopped_speed_kmh` real DEFAULT 3 NOT NULL,
	`poll_interval_ms` integer DEFAULT 120000 NOT NULL,
	`stale_threshold_ms` integer DEFAULT 43200000 NOT NULL,
	`last_processed_at` integer,
	`last_poll_succeeded_at` integer,
	`last_poll_error` text
);
--> statement-breakpoint
CREATE TABLE `trips` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`from_visit_id` integer NOT NULL,
	`to_visit_id` integer NOT NULL,
	`departed_at` integer NOT NULL,
	`arrived_at` integer NOT NULL,
	`distance_km` real NOT NULL,
	`mode` text NOT NULL,
	`path` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`from_visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trips_departed_at_idx` ON `trips` (`departed_at`);--> statement-breakpoint
CREATE TABLE `visits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`place_id` text,
	`status` text NOT NULL,
	`adhoc_label` text,
	`cluster_latitude` real,
	`cluster_longitude` real,
	`arrived_at` integer NOT NULL,
	`departed_at` integer,
	`pending_notified_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `visits_arrived_at_idx` ON `visits` (`arrived_at`);--> statement-breakpoint
CREATE INDEX `visits_status_idx` ON `visits` (`status`);