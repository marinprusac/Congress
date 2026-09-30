CREATE TABLE `chats` (
	`jid` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`is_group` integer NOT NULL,
	`last_at` integer NOT NULL,
	`last_text` text DEFAULT '' NOT NULL,
	`last_type` text,
	`last_from_me` integer DEFAULT false NOT NULL,
	`last_sender` text,
	`last_revoked` integer DEFAULT false NOT NULL,
	`unread_count` integer DEFAULT 0 NOT NULL,
	`marked_unread` integer DEFAULT false NOT NULL,
	`wrote_in` integer,
	`person_id` text,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`create_people` integer DEFAULT false NOT NULL
);
