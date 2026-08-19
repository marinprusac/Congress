CREATE TABLE `pending_checkup_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chamber` text NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`occurred_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pending_checkup_events_occurred_at_idx` ON `pending_checkup_events` (`occurred_at`);