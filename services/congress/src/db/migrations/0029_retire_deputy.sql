ALTER TABLE `settings` ADD `directives_imported_at` integer;--> statement-breakpoint
-- The Deputy Chamber was retired: its directives became Congress's own
-- tracked items (ai/legacyDirectivesImport.ts). Drop what the registry,
-- exhibit cache and event catalog still hold for it.
DELETE FROM `chambers` WHERE `name` = 'deputy';--> statement-breakpoint
DELETE FROM `exhibit_refs` WHERE `source_chamber` = 'deputy' OR `target_id` LIKE 'directive-%';--> statement-breakpoint
DELETE FROM `exhibit_cache` WHERE `chamber` = 'deputy';--> statement-breakpoint
DELETE FROM `event_settings` WHERE `event_type` LIKE 'deputy.%';
