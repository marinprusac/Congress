ALTER TABLE `chats` ADD `muted_until` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `chats` ADD `muted` integer DEFAULT false NOT NULL;