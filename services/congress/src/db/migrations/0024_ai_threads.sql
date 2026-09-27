CREATE TABLE `ai_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` integer,
	`kind` text NOT NULL,
	`trigger` text,
	`actor` text NOT NULL,
	`model` text,
	`status` text NOT NULL,
	`error_message` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`cost_usd` real,
	`input_tokens` integer,
	`output_tokens` integer,
	`duration_ms` integer,
	`tool_call_count` integer DEFAULT 0 NOT NULL,
	`activity_json` text,
	`verdict_json` text
);
--> statement-breakpoint
CREATE INDEX `ai_runs_started_at_idx` ON `ai_runs` (`started_at`);--> statement-breakpoint
CREATE INDEX `ai_runs_thread_id_idx` ON `ai_runs` (`thread_id`);--> statement-breakpoint
CREATE TABLE `ai_threads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text,
	`origin` text DEFAULT 'owner' NOT NULL,
	`tracking_id` integer,
	`session_id` text,
	`pending_run_id` text,
	`pinned_at` integer,
	`archived_at` integer,
	`last_read_at` integer,
	`last_message_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_threads_last_message_at_idx` ON `ai_threads` (`last_message_at`);--> statement-breakpoint
DROP INDEX `ai_messages_session_id_idx`;--> statement-breakpoint
INSERT INTO `ai_threads` (`title`, `origin`, `session_id`, `last_read_at`, `last_message_at`, `created_at`)
  SELECT 'Earlier chat', 'owner', (SELECT `session_id` FROM `ai_messages` ORDER BY `created_at` DESC LIMIT 1), MAX(`created_at`), MAX(`created_at`), MIN(`created_at`)
  FROM `ai_messages` HAVING COUNT(*) > 0;--> statement-breakpoint
ALTER TABLE `ai_messages` ADD `thread_id` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `ai_messages` SET `thread_id` = (SELECT `id` FROM `ai_threads` ORDER BY `id` LIMIT 1);--> statement-breakpoint
ALTER TABLE `ai_messages` ADD `kind` text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_messages` ADD `status` text DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_messages` ADD `run_id` text;--> statement-breakpoint
ALTER TABLE `ai_messages` ADD `payload_json` text;--> statement-breakpoint
ALTER TABLE `ai_messages` ADD `ask_state` text;--> statement-breakpoint
ALTER TABLE `ai_messages` ADD `urgency` text;--> statement-breakpoint
ALTER TABLE `ai_messages` ADD `deliver_at` integer;--> statement-breakpoint
ALTER TABLE `ai_messages` ADD `expires_at` integer;--> statement-breakpoint
CREATE INDEX `ai_messages_thread_id_idx` ON `ai_messages` (`thread_id`,`id`);--> statement-breakpoint
CREATE INDEX `ai_messages_ask_state_idx` ON `ai_messages` (`ask_state`);