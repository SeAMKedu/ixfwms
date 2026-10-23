CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_by` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `location_types` ADD `stay_days` integer;--> statement-breakpoint
ALTER TABLE `locations` ADD `stay_days` integer;--> statement-breakpoint
ALTER TABLE `locations` ADD `contact` text;--> statement-breakpoint
ALTER TABLE `locations` ADD `last_activity_at` text;--> statement-breakpoint
-- Pallets are temporary by default; activity starts counting from the last change.
UPDATE `location_types` SET `stay_days` = 14 WHERE `key` = 'pallet';--> statement-breakpoint
UPDATE `locations` SET `last_activity_at` = `updated_at`;
