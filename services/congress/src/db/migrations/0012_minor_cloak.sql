CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chamber` text NOT NULL,
	`type` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`occurred_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_occurred_at_idx` ON `events` (`occurred_at`);--> statement-breakpoint
ALTER TABLE `chambers` ADD `events_json` text DEFAULT '[]' NOT NULL;