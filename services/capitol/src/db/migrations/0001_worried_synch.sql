CREATE TABLE `exhibit_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`chamber` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `exhibit_refs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` text NOT NULL,
	`source_chamber` text NOT NULL,
	`target_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `exhibit_refs_source_id_idx` ON `exhibit_refs` (`source_id`);--> statement-breakpoint
CREATE INDEX `exhibit_refs_target_id_idx` ON `exhibit_refs` (`target_id`);