CREATE TABLE `task_refs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`target_exhibit_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_refs_task_target_idx` ON `task_refs` (`task_id`,`target_exhibit_id`);