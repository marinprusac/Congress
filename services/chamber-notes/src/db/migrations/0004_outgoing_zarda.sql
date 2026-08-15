CREATE TABLE `note_refs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`note_id` integer NOT NULL,
	`target_exhibit_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `note_refs_note_target_idx` ON `note_refs` (`note_id`,`target_exhibit_id`);