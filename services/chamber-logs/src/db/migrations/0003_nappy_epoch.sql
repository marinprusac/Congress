CREATE TABLE `event_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rule_id` integer NOT NULL,
	`chamber` text NOT NULL,
	`type` text NOT NULL,
	`priority_rank` integer DEFAULT 1 NOT NULL,
	`payload_json` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `event_history_occurred_at_idx` ON `event_history` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `event_history_priority_rank_idx` ON `event_history` (`priority_rank`);--> statement-breakpoint
CREATE INDEX `event_history_expires_at_idx` ON `event_history` (`expires_at`);--> statement-breakpoint
CREATE TABLE `log_rule_refs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`log_rule_id` integer NOT NULL,
	`target_exhibit_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `log_rule_refs_rule_target_idx` ON `log_rule_refs` (`log_rule_id`,`target_exhibit_id`);--> statement-breakpoint
CREATE TABLE `log_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`trigger_event_type` text NOT NULL,
	`condition_field` text,
	`condition_equals` text,
	`min_priority` text,
	`record_to_history` integer DEFAULT true NOT NULL,
	`history_retention_ms` integer,
	`notify` integer DEFAULT false NOT NULL,
	`notify_title_template` text,
	`notify_body_template` text,
	`notify_url_template` text,
	`notify_dedupe_key_template` text,
	`enabled` integer DEFAULT true NOT NULL,
	`last_fired_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `log_rules_trigger_event_type_idx` ON `log_rules` (`trigger_event_type`);