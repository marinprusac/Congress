CREATE TABLE `settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`hidden_widgets_json` text DEFAULT '[]' NOT NULL
);
