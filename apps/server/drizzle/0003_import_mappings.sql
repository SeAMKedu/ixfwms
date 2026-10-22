CREATE TABLE `import_mappings` (
	`name` text PRIMARY KEY NOT NULL,
	`mapping` text NOT NULL,
	`updated_by` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
