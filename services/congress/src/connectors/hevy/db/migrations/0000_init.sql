CREATE TABLE `folders` (
	`id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `routines` (
	`hevy_id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`folder_id` integer,
	`exercises_json` text NOT NULL,
	`hevy_updated_at` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`api_key` text,
	`cursor` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`publish_events` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workouts` (
	`hevy_id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`start_time` integer NOT NULL,
	`end_time` integer NOT NULL,
	`exercise_count` integer DEFAULT 0 NOT NULL,
	`total_volume_kg` real,
	`exercises_json` text NOT NULL,
	`exercise_names` text DEFAULT '' NOT NULL,
	`updated_at` integer NOT NULL
);
