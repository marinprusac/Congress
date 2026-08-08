CREATE TABLE `links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_note_id` integer NOT NULL,
	`target_title` text NOT NULL,
	FOREIGN KEY (`source_note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `links_source_note_id_idx` ON `links` (`source_note_id`);--> statement-breakpoint
CREATE INDEX `links_target_title_idx` ON `links` (`target_title`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`frontmatter_json` text DEFAULT '{}' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notes_title_unique` ON `notes` (`title`);