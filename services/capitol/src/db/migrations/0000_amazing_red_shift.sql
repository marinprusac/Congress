CREATE TABLE `chambers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`display_name` text NOT NULL,
	`version` text NOT NULL,
	`routes_json` text NOT NULL,
	`api_base` text NOT NULL,
	`mcp_url` text,
	`health_url` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_heartbeat_at` integer,
	`registered_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chambers_name_unique` ON `chambers` (`name`);