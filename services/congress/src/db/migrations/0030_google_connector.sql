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
CREATE UNIQUE INDEX `google_accounts_google_sub_unique` ON `google_accounts` (`google_sub`);