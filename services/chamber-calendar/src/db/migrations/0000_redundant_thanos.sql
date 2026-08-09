CREATE TABLE `google_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`email` text NOT NULL,
	`google_sub` text NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`scope` text NOT NULL,
	`token_expiry` integer NOT NULL,
	`needs_reconnect` integer DEFAULT false NOT NULL,
	`connected_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_accounts_google_sub_unique` ON `google_accounts` (`google_sub`);--> statement-breakpoint
CREATE TABLE `selected_calendars` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`google_calendar_id` text NOT NULL,
	`summary` text NOT NULL,
	`color_hex` text,
	`selected` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `google_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `selected_calendars_account_id_idx` ON `selected_calendars` (`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `selected_calendars_account_calendar_idx` ON `selected_calendars` (`account_id`,`google_calendar_id`);