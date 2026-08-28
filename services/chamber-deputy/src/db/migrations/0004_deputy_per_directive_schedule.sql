ALTER TABLE `directives` ADD `interval_ms` integer;
--> statement-breakpoint
ALTER TABLE `directives` ADD `last_run_at` integer;
--> statement-breakpoint
UPDATE `directives` SET `interval_ms` = 1200000 WHERE `time_based` = 1;
--> statement-breakpoint
ALTER TABLE `directives` DROP COLUMN `time_based`;
--> statement-breakpoint
ALTER TABLE `settings` RENAME COLUMN `persona_prompt` TO `context_prompt`;
--> statement-breakpoint
ALTER TABLE `settings` DROP COLUMN `checkup_interval_ms`;
--> statement-breakpoint
CREATE TABLE `deputy_spend` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cost_usd` real,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deputy_spend_created_at_idx` ON `deputy_spend` (`created_at`);--> statement-breakpoint
DROP TABLE `deputy_runs`;
