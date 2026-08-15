CREATE TABLE `event_refs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exhibit_id` text NOT NULL,
	`target_exhibit_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_refs_exhibit_target_idx` ON `event_refs` (`exhibit_id`,`target_exhibit_id`);