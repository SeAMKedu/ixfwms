-- Where a lot belongs back to, stored instead of guessed from the movement history.
ALTER TABLE `stock_lots` ADD `origin_location_id` text REFERENCES `locations`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
-- A guest's name on a move gets its own column instead of the note.
ALTER TABLE `stock_movements` ADD `reporter_name` text;
--> statement-breakpoint
-- Existing lots: the old guess, once. The last move of this part into its place came from
-- somewhere; when that was "being carried", the move before it says where it was picked up.
UPDATE `stock_lots` SET `origin_location_id` = (
  SELECT CASE WHEN `l`.`kind` = 'in_transit' THEN (
      SELECT `m2`.`from_location_id` FROM `stock_movements` `m2`
      WHERE `m2`.`part_id` = `stock_lots`.`part_id`
        AND `m2`.`to_location_id` = `m`.`from_location_id`
        AND `m2`.`reason` = 'move'
        AND `m2`.`created_at` <= `m`.`created_at`
      ORDER BY `m2`.`created_at` DESC LIMIT 1)
    ELSE `m`.`from_location_id` END
  FROM `stock_movements` `m`
  INNER JOIN `locations` `l` ON `l`.`id` = `m`.`from_location_id`
  WHERE `m`.`part_id` = `stock_lots`.`part_id`
    AND `m`.`to_location_id` = `stock_lots`.`location_id`
    AND `m`.`reason` = 'move'
  ORDER BY `m`.`created_at` DESC LIMIT 1
);
--> statement-breakpoint
-- Only stock visiting somewhere (a workstation, a temporary place, being carried) keeps an
-- origin; anywhere else is home. Nor is "being carried" ever an origin.
UPDATE `stock_lots` SET `origin_location_id` = NULL
WHERE `origin_location_id` = `location_id`
   OR `origin_location_id` IN (SELECT `id` FROM `locations` WHERE `kind` = 'in_transit')
   OR `location_id` NOT IN (
     SELECT `l`.`id` FROM `locations` `l`
     LEFT JOIN `location_types` `t` ON `t`.`id` = `l`.`type_id`
     WHERE `l`.`kind` = 'in_transit'
        OR `t`.`workstation` = 1
        OR (`l`.`kind` = 'normal' AND coalesce(`l`.`stay_days`, `t`.`stay_days`, 0) <> 0)
   );
--> statement-breakpoint
-- Lots that would break the one-lot rule are folded into the oldest one. Amounts add up;
-- for levels the oldest lot's level stays.
UPDATE `stock_lots` SET `quantity` = (
  SELECT sum(`s`.`quantity`) FROM `stock_lots` `s`
  WHERE `s`.`part_id` = `stock_lots`.`part_id`
    AND `s`.`location_id` = `stock_lots`.`location_id`
    AND `s`.`mode` = `stock_lots`.`mode`
    AND coalesce(`s`.`unit`, '') = coalesce(`stock_lots`.`unit`, '')
    AND coalesce(`s`.`origin_location_id`, '') = coalesce(`stock_lots`.`origin_location_id`, '')
)
WHERE `mode` <> 'level' AND `id` IN (
  SELECT min(`id`) FROM `stock_lots`
  GROUP BY `part_id`, `location_id`, `mode`, coalesce(`unit`, ''), coalesce(`origin_location_id`, '')
  HAVING count(*) > 1
);
--> statement-breakpoint
DELETE FROM `stock_lots` WHERE `id` NOT IN (
  SELECT min(`id`) FROM `stock_lots`
  GROUP BY `part_id`, `location_id`, `mode`, coalesce(`unit`, ''), coalesce(`origin_location_id`, '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_lots_one_per_place` ON `stock_lots` (
  `part_id`, `location_id`, `mode`, coalesce(`unit`, ''), coalesce(`origin_location_id`, '')
);
