CREATE INDEX `tasks_updated_at_idx` ON `tasks` (`updated_at`);--> statement-breakpoint
CREATE INDEX `tasks_completed_due_date_idx` ON `tasks` (`completed`,`due_date`);