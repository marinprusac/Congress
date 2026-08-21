DROP INDEX `event_history_priority_rank_idx`;--> statement-breakpoint
CREATE INDEX `event_history_priority_rank_occurred_at_idx` ON `event_history` (`priority_rank`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `notifications_read_at_idx` ON `notifications` (`read_at`);