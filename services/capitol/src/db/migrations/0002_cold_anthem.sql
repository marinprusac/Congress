CREATE TABLE `shares` (
	`id` text PRIMARY KEY NOT NULL,
	`root_id` text NOT NULL,
	`root_chamber` text NOT NULL,
	`max_depth` integer NOT NULL,
	`permission` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	`last_accessed_at` integer
);
