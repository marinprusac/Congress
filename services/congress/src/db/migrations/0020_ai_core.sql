CREATE TABLE `ai_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_messages_session_id_idx` ON `ai_messages` (`session_id`);--> statement-breakpoint
CREATE INDEX `ai_messages_created_at_idx` ON `ai_messages` (`created_at`);--> statement-breakpoint
CREATE TABLE `ai_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`context_prompt` text DEFAULT '' NOT NULL,
	`chat_idle_window_ms` integer DEFAULT 1800000 NOT NULL,
	`budget_cap_usd` real DEFAULT 10 NOT NULL,
	`model` text DEFAULT 'claude-sonnet-5' NOT NULL,
	`retention_days` integer DEFAULT 30 NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`paused_reason` text
);
--> statement-breakpoint
CREATE TABLE `ai_spend` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor` text NOT NULL,
	`cost_usd` real,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_spend_created_at_idx` ON `ai_spend` (`created_at`);