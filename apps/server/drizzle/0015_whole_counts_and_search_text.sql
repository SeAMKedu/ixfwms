-- Search compares against text folded by the app (fold()): SQL lower() in SQLite folds only
-- A–Z. Filled in at startup for existing rows (fillSearchText), written on every change after.
ALTER TABLE `parts` ADD `search_text` text;
--> statement-breakpoint
ALTER TABLE `units` ADD `search_text` text;
--> statement-breakpoint
-- Pieces are whole numbers, now in the database too. The services always checked; anything
-- fractional that got in some other way is rounded first, so the copy below can't fail.
UPDATE `stock_lots` SET `quantity` = round(`quantity`)
WHERE `mode` = 'count' AND `quantity` <> cast(`quantity` AS integer);
--> statement-breakpoint
-- SQLite adds a CHECK only by rebuilding the table. Nothing references stock_lots by key.
CREATE TABLE `__new_stock_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`part_id` text NOT NULL,
	`location_id` text NOT NULL,
	`mode` text NOT NULL,
	`quantity` real,
	`unit` text,
	`level` text,
	`tare_g` real,
	`note` text,
	`last_checked_at` text,
	`origin_location_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`origin_location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT `stock_lots_whole_count` CHECK(`mode` <> 'count' OR `quantity` = cast(`quantity` AS integer))
);
--> statement-breakpoint
INSERT INTO `__new_stock_lots` (`id`, `part_id`, `location_id`, `mode`, `quantity`, `unit`, `level`, `tare_g`, `note`, `last_checked_at`, `origin_location_id`, `created_at`, `updated_at`)
SELECT `id`, `part_id`, `location_id`, `mode`, `quantity`, `unit`, `level`, `tare_g`, `note`, `last_checked_at`, `origin_location_id`, `created_at`, `updated_at` FROM `stock_lots`;
--> statement-breakpoint
DROP TABLE `stock_lots`;
--> statement-breakpoint
ALTER TABLE `__new_stock_lots` RENAME TO `stock_lots`;
--> statement-breakpoint
CREATE INDEX `stock_lots_part_idx` ON `stock_lots` (`part_id`);
--> statement-breakpoint
CREATE INDEX `stock_lots_location_idx` ON `stock_lots` (`location_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_lots_one_per_place` ON `stock_lots` (
  `part_id`, `location_id`, `mode`, coalesce(`unit`, ''), coalesce(`origin_location_id`, '')
);
