CREATE TABLE `cached_events` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` integer NOT NULL,
	`calendar_id` text NOT NULL,
	`event_id` text NOT NULL,
	`calendar_summary` text NOT NULL,
	`calendar_color` text,
	`title` text NOT NULL,
	`description` text,
	`location` text,
	`all_day` integer NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`html_link` text,
	`editable` integer NOT NULL,
	`google_updated_at` text NOT NULL,
	`synced_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `google_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cached_events_account_calendar_idx` ON `cached_events` (`account_id`,`calendar_id`);--> statement-breakpoint
CREATE INDEX `cached_events_start_idx` ON `cached_events` (`start`);