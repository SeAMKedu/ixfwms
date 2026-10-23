CREATE TABLE `map_drawings` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`file_id` text NOT NULL,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `map_links` (
	`id` text PRIMARY KEY NOT NULL,
	`usage_id` text NOT NULL,
	`element_key` text NOT NULL,
	`target_id` text NOT NULL,
	FOREIGN KEY (`usage_id`) REFERENCES `map_usages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `map_links_element` ON `map_links` (`usage_id`,`element_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `map_links_target` ON `map_links` (`usage_id`,`target_id`);--> statement-breakpoint
CREATE TABLE `map_usages` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`drawing_id` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`drawing_id`) REFERENCES `map_drawings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `map_usages_unique` ON `map_usages` (`location_id`,`kind`);--> statement-breakpoint
-- Existing maps become a drawing each, used by the place they belonged to. Their loc-<code> ids keep linking automatically.
INSERT INTO `map_drawings` (`id`, `name`, `kind`, `file_id`, `created_by`, `created_at`, `updated_at`)
SELECT v.`id`, coalesce(f.`filename`, 'map'), v.`kind`, v.`file_id`, v.`created_by`, v.`created_at`, v.`created_at`
FROM `location_views` v LEFT JOIN `files` f ON f.`id` = v.`file_id`;--> statement-breakpoint
INSERT INTO `map_usages` (`id`, `location_id`, `drawing_id`, `kind`, `created_at`)
SELECT v.`id`, v.`location_id`, v.`id`, v.`kind`, v.`created_at` FROM `location_views` v;
