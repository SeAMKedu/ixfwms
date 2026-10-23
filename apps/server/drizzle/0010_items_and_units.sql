CREATE TABLE `loans` (
	`id` text PRIMARY KEY NOT NULL,
	`unit_id` text NOT NULL,
	`responsible_user_id` text NOT NULL,
	`description` text NOT NULL,
	`out_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`due_at` text,
	`returned_at` text,
	`returned_by` text,
	`created_by` text,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`responsible_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`returned_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `loans_unit_idx` ON `loans` (`unit_id`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`note` text,
	`user_id` text,
	`reporter_name` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`resolved_at` text,
	`resolved_by` text,
	`resolution` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reports_owner_idx` ON `reports` (`owner_type`,`owner_id`);--> statement-breakpoint
CREATE INDEX `reports_open_idx` ON `reports` (`resolved_at`);--> statement-breakpoint
CREATE TABLE `unit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`unit_id` text NOT NULL,
	`kind` text NOT NULL,
	`text` text,
	`value` text,
	`from_location_id` text,
	`to_location_id` text,
	`user_id` text,
	`reporter_name` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `unit_events_unit_idx` ON `unit_events` (`unit_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `units` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`part_id` text NOT NULL,
	`name` text,
	`serial_no` text,
	`status` text DEFAULT 'ok' NOT NULL,
	`location_id` text NOT NULL,
	`home_location_id` text,
	`ip_address` text,
	`hostname` text,
	`mac_address` text,
	`notes` text,
	`next_check_at` text,
	`last_seen_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`part_id`) REFERENCES `parts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`home_location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `units_code_unique` ON `units` (`code`);--> statement-breakpoint
CREATE INDEX `units_part_idx` ON `units` (`part_id`);--> statement-breakpoint
CREATE INDEX `units_location_idx` ON `units` (`location_id`);--> statement-breakpoint
CREATE INDEX `units_home_idx` ON `units` (`home_location_id`);--> statement-breakpoint
ALTER TABLE `location_types` ADD `workstation` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `parts` ADD `kind` text DEFAULT 'part' NOT NULL;--> statement-breakpoint
ALTER TABLE `parts` ADD `tracking` text DEFAULT 'bulk' NOT NULL;--> statement-breakpoint
ALTER TABLE `parts` ADD `aliases` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
-- Existing databases get the Workstation place type (a new one gets it with the other defaults on first start).
INSERT INTO `location_types` (`id`, `key`, `name`, `sort`, `movable`, `stay_days`, `workstation`)
SELECT lower(hex(randomblob(16))), 'workstation', 'Workstation / table',
  (SELECT coalesce(max(`sort`), 0) + 1 FROM `location_types`), 0, 1, 1
WHERE EXISTS (SELECT 1 FROM `location_types`)
  AND NOT EXISTS (SELECT 1 FROM `location_types` WHERE `key` = 'workstation');
