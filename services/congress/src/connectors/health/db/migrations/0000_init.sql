CREATE TABLE `health_metrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`metric_type` text NOT NULL,
	`value` real NOT NULL,
	`unit` text NOT NULL,
	`start_date` integer NOT NULL,
	`end_date` integer NOT NULL,
	`source_name` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `health_metrics_type_range_idx` ON `health_metrics` (`metric_type`,`start_date`,`end_date`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`ingest_token` text,
	`last_ingest_at` integer,
	`publish_events` integer DEFAULT false NOT NULL
);
