DROP INDEX `event_history_priority_rank_occurred_at_idx`;--> statement-breakpoint
ALTER TABLE `event_history` DROP COLUMN `priority_rank`;--> statement-breakpoint
ALTER TABLE `event_settings` DROP COLUMN `history_min_priority`;--> statement-breakpoint
ALTER TABLE `event_settings` DROP COLUMN `notify_min_priority`;