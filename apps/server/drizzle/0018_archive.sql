-- Archiving: old containers can be put away (hidden, nothing goes in), and units "retired"
-- are now "archived", the same word items use. Either can be brought back.
ALTER TABLE `locations` ADD `archived_at` text;
--> statement-breakpoint
UPDATE `units` SET `status` = 'archived' WHERE `status` = 'retired';
--> statement-breakpoint
UPDATE `unit_events` SET `value` = 'archived' WHERE `kind` = 'status' AND `value` = 'retired';
