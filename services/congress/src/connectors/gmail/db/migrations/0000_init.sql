CREATE TABLE `accounts` (
	`account_id` integer PRIMARY KEY NOT NULL,
	`history_id` text,
	`last_synced_at` integer,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`include_all_categories` integer DEFAULT false NOT NULL,
	`publish_events` integer DEFAULT false NOT NULL,
	`create_people` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `thread_addresses` (
	`thread_key` text NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`sent_to` integer DEFAULT false NOT NULL,
	`person_id` text,
	PRIMARY KEY(`thread_key`, `email`)
);
--> statement-breakpoint
CREATE TABLE `threads` (
	`key` text PRIMARY KEY NOT NULL,
	`account_id` integer NOT NULL,
	`thread_id` text NOT NULL,
	`subject` text NOT NULL,
	`from_name` text,
	`from_email` text,
	`last_at` integer NOT NULL,
	`snippet` text DEFAULT '' NOT NULL,
	`message_count` integer NOT NULL,
	`unread` integer NOT NULL,
	`inbox` integer NOT NULL,
	`label_ids` text DEFAULT '[]' NOT NULL,
	`has_attachments` integer DEFAULT false NOT NULL,
	`message_ids` text DEFAULT '[]' NOT NULL,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `threads_last_at_idx` ON `threads` (`last_at`);--> statement-breakpoint
CREATE INDEX `threads_account_idx` ON `threads` (`account_id`);