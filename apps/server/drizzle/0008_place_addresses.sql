ALTER TABLE `location_types` ADD `movable` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `locations` ADD `short_name` text;--> statement-breakpoint
-- Containers that get carried around aren't part of addresses.
UPDATE `location_types` SET `movable` = 1 WHERE `key` IN ('drawer', 'box', 'bin', 'pallet');
--> statement-breakpoint
-- New default type for existing databases (new ones get it from the defaults).
INSERT INTO `location_types` (`id`, `key`, `name`, `sort`, `movable`)
SELECT lower(hex(randomblob(16))), 'pallet', 'Pallet', coalesce((SELECT max(`sort`) FROM `location_types`), 0) + 1, 1
WHERE EXISTS (SELECT 1 FROM `location_types`) AND NOT EXISTS (SELECT 1 FROM `location_types` WHERE `key` = 'pallet');
