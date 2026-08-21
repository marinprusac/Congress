CREATE TABLE `place_refs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`place_id` integer NOT NULL,
	`target_exhibit_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `place_refs_place_target_idx` ON `place_refs` (`place_id`,`target_exhibit_id`);--> statement-breakpoint
CREATE TABLE `places` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`category` text DEFAULT 'place' NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`radius_meters` integer DEFAULT 100 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`unknown_cluster_radius_meters` integer DEFAULT 150 NOT NULL,
	`min_dwell_ms` integer DEFAULT 2700000 NOT NULL,
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
	`created_at` integer NOT NULL,
	FOREIGN KEY (`from_visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `visits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`place_id` integer,
	`status` text NOT NULL,
	`adhoc_label` text,
	`cluster_latitude` real,
	`cluster_longitude` real,
	`arrived_at` integer NOT NULL,
	`departed_at` integer,
	`pending_notified_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`place_id`) REFERENCES `places`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `visits_arrived_at_idx` ON `visits` (`arrived_at`);--> statement-breakpoint
CREATE INDEX `visits_status_idx` ON `visits` (`status`);