CREATE TABLE `local_events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`location` text,
	`description_rich` text,
	`location_rich` text,
	`all_day` integer NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `local_events_start_idx` ON `local_events` (`start`);