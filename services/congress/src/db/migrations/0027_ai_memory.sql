CREATE TABLE `ai_facts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`text` text NOT NULL,
	`source` text DEFAULT 'ai' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_tracking` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`watch_events_json` text DEFAULT '[]' NOT NULL,
	`next_check_at` integer,
	`recurrence_json` text,
	`refs_json` text DEFAULT '[]' NOT NULL,
	`thread_id` integer,
	`source` text DEFAULT 'ai' NOT NULL,
	`last_checked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_tracking_next_check_at_idx` ON `ai_tracking` (`next_check_at`);