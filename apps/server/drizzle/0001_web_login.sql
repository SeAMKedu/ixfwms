ALTER TABLE `api_tokens` ADD `kind` text DEFAULT 'api' NOT NULL;--> statement-breakpoint
ALTER TABLE `api_tokens` ADD `expires_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `password_hash` text;