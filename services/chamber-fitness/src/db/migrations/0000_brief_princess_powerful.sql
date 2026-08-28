CREATE TABLE `settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`hevy_api_key` text,
	`hevy_last_synced_at` integer,
	`hevy_consecutive_failures` integer DEFAULT 0 NOT NULL,
	`hevy_last_poll_error` text
);
--> statement-breakpoint
CREATE TABLE `workout_refs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workout_id` integer NOT NULL,
	`target_exhibit_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workout_refs_workout_target_idx` ON `workout_refs` (`workout_id`,`target_exhibit_id`);--> statement-breakpoint
CREATE TABLE `workouts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`hevy_id` text NOT NULL,
	`title` text NOT NULL,
	`start_time` integer NOT NULL,
	`end_time` integer NOT NULL,
	`exercise_count` integer DEFAULT 0 NOT NULL,
	`total_volume_kg` real,
	`exercises_json` text NOT NULL,
	`exercise_names` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workouts_hevy_id_unique` ON `workouts` (`hevy_id`);