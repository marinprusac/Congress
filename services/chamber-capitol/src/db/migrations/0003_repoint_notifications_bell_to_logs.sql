-- The old "Notifications" Chamber was split into Logs and Automation
-- (commit cd0838a), but any existing placement of its "bell" widget was
-- never repointed to the new "logs" Chamber that actually owns "bell" now
-- (see chamber-kit's exhibits.ts / Logs' manifest.ts) - so the notification
-- bell the owner already had on their canvas has been rendering as a
-- permanently-offline hatch ever since (Canvas.tsx keys placements on
-- (scope, chamber, widgetId), and "notifications" never comes back online -
-- see Congress's matching 0017_drop_stale_notifications_chamber.sql).
-- INSERT-then-DELETE rather than UPDATE so this stays idempotent and never
-- clobbers a "logs"/"bell" placement the owner may have already made by
-- hand since the split (ON CONFLICT keeps that one, the stale row is
-- dropped either way).
INSERT OR IGNORE INTO widget_layouts (scope, chamber, widget_id, x, y, updated_at)
SELECT scope, 'logs', widget_id, x, y, updated_at
FROM widget_layouts
WHERE chamber = 'notifications' AND widget_id = 'bell';
--> statement-breakpoint
DELETE FROM widget_layouts WHERE chamber = 'notifications' AND widget_id = 'bell';