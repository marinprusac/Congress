CREATE TABLE `deputy_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trigger` text NOT NULL,
	`session_id` text,
	`prompt` text NOT NULL,
	`transcript_json` text DEFAULT '[]' NOT NULL,
	`final_response` text,
	`ok` integer NOT NULL,
	`error_message` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cost_usd` real,
	`duration_ms` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deputy_runs_created_at_idx` ON `deputy_runs` (`created_at`);--> statement-breakpoint
CREATE INDEX `deputy_runs_trigger_idx` ON `deputy_runs` (`trigger`);--> statement-breakpoint
CREATE TABLE `directive_refs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`directive_id` integer NOT NULL,
	`target_exhibit_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `directive_refs_directive_target_idx` ON `directive_refs` (`directive_id`,`target_exhibit_id`);--> statement-breakpoint
CREATE TABLE `directives` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `messages_session_id_idx` ON `messages` (`session_id`);--> statement-breakpoint
CREATE INDEX `messages_created_at_idx` ON `messages` (`created_at`);--> statement-breakpoint
CREATE TABLE `poller_state` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`last_urgent_event_id` integer DEFAULT 0 NOT NULL,
	`last_checkup_event_id` integer DEFAULT 0 NOT NULL,
	`last_checkup_at` integer
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`persona_prompt` text DEFAULT '' NOT NULL,
	`checkup_interval_ms` integer DEFAULT 1200000 NOT NULL,
	`chat_idle_window_ms` integer DEFAULT 1800000 NOT NULL,
	`budget_cap_usd` real DEFAULT 10 NOT NULL,
	`model` text DEFAULT 'claude-sonnet-5' NOT NULL,
	`retention_days` integer DEFAULT 30 NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`paused_reason` text
);
