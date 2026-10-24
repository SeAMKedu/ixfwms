-- Builds: places that are things made from parts (a gripper, a test rig). What's in them isn't
-- free stock; a dismantled one keeps its row so its code still scans.
ALTER TABLE `location_types` ADD `build` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `locations` ADD `dismantled_at` text;
--> statement-breakpoint
-- Existing databases get the built-in Build type; a new one is seeded at startup (ensureDefaults).
INSERT INTO `location_types` (`id`, `key`, `name`, `sort`, `movable`, `stay_days`, `workstation`, `build`)
SELECT lower(hex(randomblob(16))), 'build', 'Build', coalesce(max(`sort`), 0) + 1, 1, 365, 0, 1
FROM `location_types`
HAVING count(*) > 0 AND sum(`key` = 'build') = 0;
