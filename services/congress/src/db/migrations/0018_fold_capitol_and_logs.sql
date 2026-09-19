CREATE TABLE `event_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chamber` text NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`actor` text,
	`occurred_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `event_history_type_idx` ON `event_history` (`type`);--> statement-breakpoint
CREATE INDEX `event_history_occurred_at_idx` ON `event_history` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `event_history_expires_at_idx` ON `event_history` (`expires_at`);--> statement-breakpoint
CREATE TABLE `event_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_type` text NOT NULL,
	`chamber` text NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`payload_fields_json` text,
	`record_to_history` integer DEFAULT true NOT NULL,
	`history_retention_ms` integer,
	`notify` integer DEFAULT false NOT NULL,
	`notify_title_template` text,
	`notify_body_template` text,
	`notify_url_template` text,
	`notify_dedupe_key_template` text,
	`last_fired_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_settings_event_type_unique` ON `event_settings` (`event_type`);--> statement-breakpoint
CREATE INDEX `event_settings_chamber_idx` ON `event_settings` (`chamber`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chamber` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`chamber_url` text,
	`created_at` integer NOT NULL,
	`read_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_chamber_dedupe_key_idx` ON `notifications` (`chamber`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notifications_created_at_idx` ON `notifications` (`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_read_at_idx` ON `notifications` (`read_at`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE TABLE `widget_layouts` (
	`scope` text NOT NULL,
	`chamber` text NOT NULL,
	`widget_id` text NOT NULL,
	`x` integer NOT NULL,
	`y` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`scope`, `chamber`, `widget_id`)
);
--> statement-breakpoint
ALTER TABLE `settings` ADD `legacy_imported_at` integer;--> statement-breakpoint
-- Capitol and Logs are core Congress features now, not registered Chambers -
-- their stale registry rows would otherwise sit "offline" forever (the
-- registry has no path to retire a Chamber, see 0017 for the same cleanup).
DELETE FROM chambers WHERE name IN ('capitol', 'logs');
