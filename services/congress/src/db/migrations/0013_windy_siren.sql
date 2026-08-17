ALTER TABLE `events` ADD `expires_at` integer NOT NULL;--> statement-breakpoint
CREATE INDEX `events_expires_at_idx` ON `events` (`expires_at`);