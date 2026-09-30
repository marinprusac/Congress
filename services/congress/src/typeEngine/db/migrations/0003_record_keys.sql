CREATE TABLE `record_keys` (
	`type_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`record_id` text NOT NULL,
	`field_id` text NOT NULL,
	PRIMARY KEY(`type_id`, `kind`, `value`)
);
--> statement-breakpoint
CREATE INDEX `record_keys_record_idx` ON `record_keys` (`record_id`);