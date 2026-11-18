CREATE TABLE `accounts` (
	`uid` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`name` text NOT NULL,
	`iban` text,
	`currency` text NOT NULL,
	`synced_through` text
);
--> statement-breakpoint
CREATE TABLE `connections` (
	`session_id` text PRIMARY KEY NOT NULL,
	`bank` text NOT NULL,
	`country` text NOT NULL,
	`valid_until` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`expiry_notified` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pending_auths` (
	`state` text PRIMARY KEY NOT NULL,
	`bank` text NOT NULL,
	`country` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`app_id` text,
	`private_key` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`key` text PRIMARY KEY NOT NULL,
	`account_uid` text NOT NULL,
	`booking_date` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text NOT NULL,
	`counterparty` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `transactions_by_date` ON `transactions` (`booking_date`);