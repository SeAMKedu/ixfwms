ALTER TABLE `parts` ADD `container` text;--> statement-breakpoint
-- Weighed amounts are now what's in the container: take the box weight off what was weighed.
UPDATE `stock_lots` SET `quantity` = max(0, `quantity` - `tare_g` / (CASE `unit` WHEN 'kg' THEN 1000 ELSE 1 END))
WHERE `mode` = 'measure' AND `unit` IN ('g', 'kg') AND `quantity` IS NOT NULL AND `tare_g` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `stock_lots` DROP COLUMN `tare_g`;
