ALTER TABLE `transactions` ADD `mcc` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `bank_code` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `counterparty_iban` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `transfer` text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Signs and transfers were wrong before this: re-read every account once (quietly) to repair them.
UPDATE `accounts` SET `synced_through` = NULL, `last_fetched_at` = NULL;
