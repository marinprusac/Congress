DROP TABLE `widget_layouts`;--> statement-breakpoint
ALTER TABLE `settings` ADD `pinned_views` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `chambers` DROP COLUMN `widgets_json`;