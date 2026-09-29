PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cached_events` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` integer NOT NULL,
	`calendar_id` text NOT NULL,
	`event_id` text NOT NULL,
	`calendar_summary` text NOT NULL,
	`calendar_color` text,
	`title` text NOT NULL,
	`description` text,
	`location` text,
	`description_rich` text,
	`location_rich` text,
	`all_day` integer NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`html_link` text,
	`editable` integer NOT NULL,
	`is_invitation` integer DEFAULT false NOT NULL,
	`attendee_response_status` text,
	`google_updated_at` text NOT NULL,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_cached_events`("id", "account_id", "calendar_id", "event_id", "calendar_summary", "calendar_color", "title", "description", "location", "description_rich", "location_rich", "all_day", "start", "end", "html_link", "editable", "is_invitation", "attendee_response_status", "google_updated_at", "synced_at") SELECT "id", "account_id", "calendar_id", "event_id", "calendar_summary", "calendar_color", "title", "description", "location", "description_rich", "location_rich", "all_day", "start", "end", "html_link", "editable", "is_invitation", "attendee_response_status", "google_updated_at", "synced_at" FROM `cached_events`;--> statement-breakpoint
DROP TABLE `cached_events`;--> statement-breakpoint
ALTER TABLE `__new_cached_events` RENAME TO `cached_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `cached_events_account_calendar_idx` ON `cached_events` (`account_id`,`calendar_id`);--> statement-breakpoint
CREATE INDEX `cached_events_start_idx` ON `cached_events` (`start`);--> statement-breakpoint
CREATE TABLE `__new_selected_calendars` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`google_calendar_id` text NOT NULL,
	`summary` text NOT NULL,
	`color_hex` text,
	`selected` integer DEFAULT false NOT NULL,
	`sync_token` text
);
--> statement-breakpoint
INSERT INTO `__new_selected_calendars`("id", "account_id", "google_calendar_id", "summary", "color_hex", "selected", "sync_token") SELECT "id", "account_id", "google_calendar_id", "summary", "color_hex", "selected", "sync_token" FROM `selected_calendars`;--> statement-breakpoint
DROP TABLE `selected_calendars`;--> statement-breakpoint
ALTER TABLE `__new_selected_calendars` RENAME TO `selected_calendars`;--> statement-breakpoint
CREATE INDEX `selected_calendars_account_id_idx` ON `selected_calendars` (`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `selected_calendars_account_calendar_idx` ON `selected_calendars` (`account_id`,`google_calendar_id`);