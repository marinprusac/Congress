CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`sha256` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL,
	`orphaned_at` integer
);
--> statement-breakpoint
CREATE INDEX `files_orphaned_idx` ON `files` (`orphaned_at`);--> statement-breakpoint
CREATE TABLE `record_trigger_state` (
	`record_id` text NOT NULL,
	`type_id` text NOT NULL,
	`ladder` text NOT NULL,
	`state` text NOT NULL,
	`fired_at` integer NOT NULL,
	PRIMARY KEY(`record_id`, `ladder`)
);
--> statement-breakpoint
CREATE INDEX `record_trigger_state_type_idx` ON `record_trigger_state` (`type_id`,`ladder`);