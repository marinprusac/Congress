CREATE TABLE `automation_refs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`automation_id` integer NOT NULL,
	`target_exhibit_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `automation_refs_automation_target_idx` ON `automation_refs` (`automation_id`,`target_exhibit_id`);--> statement-breakpoint
CREATE TABLE `automation_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`automation_id` integer NOT NULL,
	`event_id` integer NOT NULL,
	`payload_json` text NOT NULL,
	`result_title` text,
	`result_body` text,
	`fired_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `automation_runs_automation_id_idx` ON `automation_runs` (`automation_id`);--> statement-breakpoint
CREATE TABLE `automations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`trigger_event_type` text NOT NULL,
	`condition_field` text,
	`condition_equals` text,
	`action_kind` text DEFAULT 'push' NOT NULL,
	`action_title_template` text,
	`action_body_template` text,
	`action_url_template` text,
	`action_dedupe_key_template` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_fired_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `automations_trigger_event_type_idx` ON `automations` (`trigger_event_type`);--> statement-breakpoint
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
CREATE TABLE `poller_state` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`last_event_id` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL
);
