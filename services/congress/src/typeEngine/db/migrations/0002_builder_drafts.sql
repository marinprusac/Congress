CREATE TABLE `type_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`type_id` text,
	`base_version` integer NOT NULL,
	`rollback_to` integer,
	`ops_json` text NOT NULL,
	`thread_id` integer NOT NULL,
	`state` text NOT NULL,
	`problems_json` text,
	`published_version` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `type_drafts_thread_idx` ON `type_drafts` (`thread_id`,`state`);