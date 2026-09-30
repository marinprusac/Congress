CREATE TABLE `binding_outbox` (
	`record_id` text PRIMARY KEY NOT NULL,
	`binding_id` text NOT NULL,
	`op` text NOT NULL,
	`source_key` text,
	`fields_json` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_at` integer NOT NULL,
	`last_error` text,
	`failed` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `binding_outbox_next_idx` ON `binding_outbox` (`failed`,`next_at`);--> statement-breakpoint
CREATE TABLE `binding_shadows` (
	`record_id` text PRIMARY KEY NOT NULL,
	`binding_id` text NOT NULL,
	`values_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
