CREATE TABLE `document_refs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` integer NOT NULL,
	`target_exhibit_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_refs_document_target_idx` ON `document_refs` (`document_id`,`target_exhibit_id`);