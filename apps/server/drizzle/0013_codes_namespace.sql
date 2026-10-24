-- One namespace for codes: places, items, units, blank labels and retired codes.
ALTER TABLE `code_reservations` RENAME TO `codes`;
--> statement-breakpoint
ALTER TABLE `codes` ADD `owner_type` text;
--> statement-breakpoint
ALTER TABLE `codes` ADD `reserved_at` text;
--> statement-breakpoint
-- Rows that were blank labels (codes retired off a place or item carry a note and no batch).
UPDATE `codes` SET `reserved_at` = `created_at` WHERE `batch_id` IS NOT NULL OR `note` IS NULL;
--> statement-breakpoint
INSERT INTO `codes` (`code`, `owner_type`, `claimed_at`)
  SELECT `code`, 'location', strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM `locations` WHERE true
  ON CONFLICT (`code`) DO UPDATE SET
    `owner_type` = excluded.`owner_type`,
    `claimed_at` = coalesce(`codes`.`claimed_at`, excluded.`claimed_at`),
    `retired_at` = NULL
  WHERE `codes`.`owner_type` IS NULL;
--> statement-breakpoint
INSERT INTO `codes` (`code`, `owner_type`, `claimed_at`)
  SELECT `code`, 'part', strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM `parts` WHERE true
  ON CONFLICT (`code`) DO UPDATE SET
    `owner_type` = excluded.`owner_type`,
    `claimed_at` = coalesce(`codes`.`claimed_at`, excluded.`claimed_at`),
    `retired_at` = NULL
  WHERE `codes`.`owner_type` IS NULL;
--> statement-breakpoint
INSERT INTO `codes` (`code`, `owner_type`, `claimed_at`)
  SELECT `code`, 'unit', strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM `units` WHERE true
  ON CONFLICT (`code`) DO UPDATE SET
    `owner_type` = excluded.`owner_type`,
    `claimed_at` = coalesce(`codes`.`claimed_at`, excluded.`claimed_at`),
    `retired_at` = NULL
  WHERE `codes`.`owner_type` IS NULL;
--> statement-breakpoint
-- A code already on something, or retired, can't be given to a place.
CREATE TRIGGER `locations_code_check_insert` BEFORE INSERT ON `locations`
WHEN EXISTS (SELECT 1 FROM `codes` WHERE `code` = NEW.`code` AND (`owner_type` IS NOT NULL OR `retired_at` IS NOT NULL))
BEGIN
  SELECT RAISE(ABORT, 'code is already in use or retired');
END;
--> statement-breakpoint
CREATE TRIGGER `locations_code_check_update` BEFORE UPDATE OF `code` ON `locations`
WHEN NEW.`code` <> OLD.`code` AND EXISTS (SELECT 1 FROM `codes` WHERE `code` = NEW.`code` AND (`owner_type` IS NOT NULL OR `retired_at` IS NOT NULL))
BEGIN
  SELECT RAISE(ABORT, 'code is already in use or retired');
END;
--> statement-breakpoint
CREATE TRIGGER `locations_code_claim` AFTER INSERT ON `locations`
BEGIN
  INSERT OR IGNORE INTO `codes` (`code`) VALUES (NEW.`code`);
  UPDATE `codes` SET `owner_type` = 'location', `claimed_at` = coalesce(`claimed_at`, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    WHERE `code` = NEW.`code`;
END;
--> statement-breakpoint
-- The old code is let go: retired by the service if it should be, otherwise forgotten
-- (a temporary code during a swap) unless it was printed on a blank label.
CREATE TRIGGER `locations_code_change` AFTER UPDATE OF `code` ON `locations`
WHEN NEW.`code` <> OLD.`code`
BEGIN
  UPDATE `codes` SET `owner_type` = NULL WHERE `code` = OLD.`code`;
  DELETE FROM `codes`
    WHERE `code` = OLD.`code` AND `reserved_at` IS NULL AND `retired_at` IS NULL;
  INSERT OR IGNORE INTO `codes` (`code`) VALUES (NEW.`code`);
  UPDATE `codes` SET `owner_type` = 'location', `claimed_at` = coalesce(`claimed_at`, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    WHERE `code` = NEW.`code`;
END;
--> statement-breakpoint
-- A deleted place's code is retired, so an old label never points at something new.
CREATE TRIGGER `locations_code_release` AFTER DELETE ON `locations`
BEGIN
  UPDATE `codes` SET
    `owner_type` = NULL,
    `retired_at` = coalesce(`retired_at`, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    `note` = coalesce(`note`, 'was place ' || OLD.`name`)
  WHERE `code` = OLD.`code`;
END;
--> statement-breakpoint
-- A code already on something, or retired, can't be given to a part.
CREATE TRIGGER `parts_code_check_insert` BEFORE INSERT ON `parts`
WHEN EXISTS (SELECT 1 FROM `codes` WHERE `code` = NEW.`code` AND (`owner_type` IS NOT NULL OR `retired_at` IS NOT NULL))
BEGIN
  SELECT RAISE(ABORT, 'code is already in use or retired');
END;
--> statement-breakpoint
CREATE TRIGGER `parts_code_check_update` BEFORE UPDATE OF `code` ON `parts`
WHEN NEW.`code` <> OLD.`code` AND EXISTS (SELECT 1 FROM `codes` WHERE `code` = NEW.`code` AND (`owner_type` IS NOT NULL OR `retired_at` IS NOT NULL))
BEGIN
  SELECT RAISE(ABORT, 'code is already in use or retired');
END;
--> statement-breakpoint
CREATE TRIGGER `parts_code_claim` AFTER INSERT ON `parts`
BEGIN
  INSERT OR IGNORE INTO `codes` (`code`) VALUES (NEW.`code`);
  UPDATE `codes` SET `owner_type` = 'part', `claimed_at` = coalesce(`claimed_at`, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    WHERE `code` = NEW.`code`;
END;
--> statement-breakpoint
-- The old code is let go: retired by the service if it should be, otherwise forgotten
-- (a temporary code during a swap) unless it was printed on a blank label.
CREATE TRIGGER `parts_code_change` AFTER UPDATE OF `code` ON `parts`
WHEN NEW.`code` <> OLD.`code`
BEGIN
  UPDATE `codes` SET `owner_type` = NULL WHERE `code` = OLD.`code`;
  DELETE FROM `codes`
    WHERE `code` = OLD.`code` AND `reserved_at` IS NULL AND `retired_at` IS NULL;
  INSERT OR IGNORE INTO `codes` (`code`) VALUES (NEW.`code`);
  UPDATE `codes` SET `owner_type` = 'part', `claimed_at` = coalesce(`claimed_at`, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    WHERE `code` = NEW.`code`;
END;
--> statement-breakpoint
-- A deleted part's code is retired, so an old label never points at something new.
CREATE TRIGGER `parts_code_release` AFTER DELETE ON `parts`
BEGIN
  UPDATE `codes` SET
    `owner_type` = NULL,
    `retired_at` = coalesce(`retired_at`, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    `note` = coalesce(`note`, 'was part ' || OLD.`name`)
  WHERE `code` = OLD.`code`;
END;
--> statement-breakpoint
-- A code already on something, or retired, can't be given to a unit.
CREATE TRIGGER `units_code_check_insert` BEFORE INSERT ON `units`
WHEN EXISTS (SELECT 1 FROM `codes` WHERE `code` = NEW.`code` AND (`owner_type` IS NOT NULL OR `retired_at` IS NOT NULL))
BEGIN
  SELECT RAISE(ABORT, 'code is already in use or retired');
END;
--> statement-breakpoint
CREATE TRIGGER `units_code_check_update` BEFORE UPDATE OF `code` ON `units`
WHEN NEW.`code` <> OLD.`code` AND EXISTS (SELECT 1 FROM `codes` WHERE `code` = NEW.`code` AND (`owner_type` IS NOT NULL OR `retired_at` IS NOT NULL))
BEGIN
  SELECT RAISE(ABORT, 'code is already in use or retired');
END;
--> statement-breakpoint
CREATE TRIGGER `units_code_claim` AFTER INSERT ON `units`
BEGIN
  INSERT OR IGNORE INTO `codes` (`code`) VALUES (NEW.`code`);
  UPDATE `codes` SET `owner_type` = 'unit', `claimed_at` = coalesce(`claimed_at`, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    WHERE `code` = NEW.`code`;
END;
--> statement-breakpoint
-- The old code is let go: retired by the service if it should be, otherwise forgotten
-- (a temporary code during a swap) unless it was printed on a blank label.
CREATE TRIGGER `units_code_change` AFTER UPDATE OF `code` ON `units`
WHEN NEW.`code` <> OLD.`code`
BEGIN
  UPDATE `codes` SET `owner_type` = NULL WHERE `code` = OLD.`code`;
  DELETE FROM `codes`
    WHERE `code` = OLD.`code` AND `reserved_at` IS NULL AND `retired_at` IS NULL;
  INSERT OR IGNORE INTO `codes` (`code`) VALUES (NEW.`code`);
  UPDATE `codes` SET `owner_type` = 'unit', `claimed_at` = coalesce(`claimed_at`, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    WHERE `code` = NEW.`code`;
END;
--> statement-breakpoint
-- A deleted unit's code is retired, so an old label never points at something new.
CREATE TRIGGER `units_code_release` AFTER DELETE ON `units`
BEGIN
  UPDATE `codes` SET
    `owner_type` = NULL,
    `retired_at` = coalesce(`retired_at`, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    `note` = coalesce(`note`, 'was unit ' || coalesce(OLD.`name`, OLD.`code`))
  WHERE `code` = OLD.`code`;
END;
