CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` integer NOT NULL,
	`message_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`from_name` text,
	`from_email` text,
	`to` text,
	`subject` text NOT NULL,
	`snippet` text NOT NULL,
	`internal_date` integer NOT NULL,
	`label_ids` text DEFAULT '[]' NOT NULL,
	`unread` integer NOT NULL,
	`in_inbox` integer NOT NULL,
	`has_attachments` integer DEFAULT false NOT NULL,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `messages_account_thread_idx` ON `messages` (`account_id`,`thread_id`);--> statement-breakpoint
CREATE INDEX `messages_internal_date_idx` ON `messages` (`internal_date`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`include_all_categories` integer DEFAULT false NOT NULL,
	`feed_window_hours` integer DEFAULT 24 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`account_id` integer PRIMARY KEY NOT NULL,
	`history_id` text,
	`last_synced_at` integer,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `thread_refs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exhibit_id` text NOT NULL,
	`target_exhibit_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `thread_refs_exhibit_target_idx` ON `thread_refs` (`exhibit_id`,`target_exhibit_id`);