CREATE TABLE `imports` (
	`key` text PRIMARY KEY NOT NULL,
	`ran_at` integer NOT NULL,
	`stats_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `legacy_aliases` (
	`legacy_chamber` text NOT NULL,
	`legacy_id` text NOT NULL,
	`record_id` text NOT NULL,
	PRIMARY KEY(`legacy_chamber`, `legacy_id`)
);
--> statement-breakpoint
CREATE INDEX `legacy_aliases_record_idx` ON `legacy_aliases` (`record_id`);--> statement-breakpoint
CREATE TABLE `record_refs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`record_id` text NOT NULL,
	`target_exhibit_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `record_refs_pair_idx` ON `record_refs` (`record_id`,`target_exhibit_id`);--> statement-breakpoint
CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`type_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `records_type_idx` ON `records` (`type_id`);--> statement-breakpoint
CREATE TABLE `type_versions` (
	`type_id` text NOT NULL,
	`version` integer NOT NULL,
	`definition_json` text NOT NULL,
	`ops_json` text NOT NULL,
	`plan_json` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`type_id`, `version`)
);
--> statement-breakpoint
CREATE TABLE `types` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`table_name` text NOT NULL,
	`current_version` integer NOT NULL,
	`definition_json` text NOT NULL,
	`origin` text NOT NULL,
	`premade_key` text,
	`premade_batch` integer DEFAULT 0 NOT NULL,
	`forked` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `types_slug_unique` ON `types` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `types_table_name_unique` ON `types` (`table_name`);