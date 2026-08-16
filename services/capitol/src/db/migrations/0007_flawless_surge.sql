CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chamber` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`chamber_url` text,
	`created_at` integer NOT NULL,
	`read_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_chamber_dedupe_key_idx` ON `notifications` (`chamber`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notifications_created_at_idx` ON `notifications` (`created_at`);