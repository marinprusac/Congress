CREATE TABLE `widget_layouts` (
	`scope` text NOT NULL,
	`chamber` text NOT NULL,
	`widget_id` text NOT NULL,
	`x` integer NOT NULL,
	`y` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`scope`, `chamber`, `widget_id`)
);
