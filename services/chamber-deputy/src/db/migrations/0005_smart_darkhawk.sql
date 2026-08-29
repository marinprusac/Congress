ALTER TABLE `directives` ADD `schedule_type` text;--> statement-breakpoint
ALTER TABLE `directives` ADD `schedule_hour` integer;--> statement-breakpoint
ALTER TABLE `directives` ADD `schedule_minute` integer;--> statement-breakpoint
ALTER TABLE `directives` ADD `schedule_day_of_week` integer;--> statement-breakpoint
ALTER TABLE `directives` ADD `schedule_time_zone` text;--> statement-breakpoint
ALTER TABLE `directives` ADD `trigger_event_type` text;--> statement-breakpoint
UPDATE `directives` SET `schedule_type` = 'interval' WHERE `interval_ms` IS NOT NULL;