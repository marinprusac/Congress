CREATE TABLE `accounts` (
	`account_id` integer PRIMARY KEY NOT NULL,
	`seeded_at` integer,
	`last_synced_at` integer,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `calendars` (
	`account_id` integer NOT NULL,
	`calendar_id` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`color` text,
	`access_role` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`selected` integer DEFAULT false NOT NULL,
	`sync_token` text,
	PRIMARY KEY(`account_id`, `calendar_id`)
);
--> statement-breakpoint
CREATE TABLE `event_attendees` (
	`event_key` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text,
	`response_status` text,
	`organizer` integer DEFAULT false NOT NULL,
	`self` integer DEFAULT false NOT NULL,
	`resource` integer DEFAULT false NOT NULL,
	`optional` integer DEFAULT false NOT NULL,
	`person_id` text,
	`tried_evidence` text,
	PRIMARY KEY(`event_key`, `email`)
);
--> statement-breakpoint
CREATE INDEX `event_attendees_email_idx` ON `event_attendees` (`email`);--> statement-breakpoint
CREATE TABLE `events` (
	`key` text PRIMARY KEY NOT NULL,
	`account_id` integer NOT NULL,
	`calendar_id` text NOT NULL,
	`event_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`all_day` integer NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`start_ms` integer NOT NULL,
	`end_ms` integer NOT NULL,
	`time_zone` text,
	`html_link` text,
	`recurring_event_id` text,
	`organizer_email` text,
	`organizer_self` integer NOT NULL,
	`guests_can_modify` integer NOT NULL,
	`self_response` text,
	`google_updated` text,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_calendar_idx` ON `events` (`account_id`,`calendar_id`);--> statement-breakpoint
CREATE INDEX `events_start_idx` ON `events` (`start_ms`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
