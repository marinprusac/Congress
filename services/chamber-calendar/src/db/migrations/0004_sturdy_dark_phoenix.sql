CREATE TABLE `event_attendance` (
	`exhibit_id` text PRIMARY KEY NOT NULL,
	`not_attending` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `cached_events` ADD `is_invitation` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `cached_events` ADD `attendee_response_status` text;--> statement-breakpoint
-- Every already-cached row just got `is_invitation`/`attendee_response_status`
-- defaulted to false/null, not backfilled - the poll-sync (google/cache.ts)
-- only re-fetches a row once Google's own `updated` timestamp moves, so an
-- unrelated deploy wouldn't otherwise correct a stale default until an
-- event's next real edit. Clearing the stored sync token forces the next
-- 5-minute poll down the full-resync path (the same one a 410 Gone triggers)
-- instead of the cheap incremental one, so every cached row gets its real
-- attendance recomputed from a fresh Google fetch immediately.
UPDATE `selected_calendars` SET `sync_token` = NULL;