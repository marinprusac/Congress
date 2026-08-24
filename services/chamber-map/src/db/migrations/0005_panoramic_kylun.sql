CREATE TABLE `positions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`traccar_position_id` integer NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`speed_knots` real NOT NULL,
	`fix_time` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `positions_traccar_id_idx` ON `positions` (`traccar_position_id`);--> statement-breakpoint
CREATE INDEX `positions_fix_time_idx` ON `positions` (`fix_time`);