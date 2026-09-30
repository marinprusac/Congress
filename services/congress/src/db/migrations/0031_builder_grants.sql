CREATE TABLE `ai_builder_grants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` integer NOT NULL,
	`request_message_id` integer NOT NULL,
	`granted_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE INDEX `ai_builder_grants_thread_idx` ON `ai_builder_grants` (`thread_id`,`expires_at`);