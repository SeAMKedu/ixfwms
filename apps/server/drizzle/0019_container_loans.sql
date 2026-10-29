-- Lending a whole container (a drone case with its batteries): a loan is of a unit or a place,
-- and remembers where the place was so it can go back there.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_loans` (
	`id` text PRIMARY KEY NOT NULL,
	`unit_id` text,
	`location_id` text,
	`from_location_id` text,
	`responsible_user_id` text NOT NULL,
	`description` text NOT NULL,
	`out_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`due_at` text,
	`returned_at` text,
	`returned_by` text,
	`created_by` text,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`responsible_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`returned_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_loans`("id", "unit_id", "location_id", "from_location_id", "responsible_user_id", "description", "out_at", "due_at", "returned_at", "returned_by", "created_by") SELECT "id", "unit_id", NULL, NULL, "responsible_user_id", "description", "out_at", "due_at", "returned_at", "returned_by", "created_by" FROM `loans`;--> statement-breakpoint
DROP TABLE `loans`;--> statement-breakpoint
ALTER TABLE `__new_loans` RENAME TO `loans`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `loans_unit_idx` ON `loans` (`unit_id`);--> statement-breakpoint
CREATE INDEX `loans_location_idx` ON `loans` (`location_id`);