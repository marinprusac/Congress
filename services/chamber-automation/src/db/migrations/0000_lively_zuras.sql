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
	`target_chamber` text NOT NULL,
	`tool_name` text NOT NULL,
	`ok` integer NOT NULL,
	`result_json` text,
	`error_message` text,
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
	`target_chamber` text NOT NULL,
	`tool_name` text NOT NULL,
	`args_template_json` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_fired_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `automations_trigger_event_type_idx` ON `automations` (`trigger_event_type`);--> statement-breakpoint
CREATE TABLE `poller_state` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`last_event_id` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL
);
