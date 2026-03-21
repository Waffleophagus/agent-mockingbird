ALTER TABLE `usage_events` ADD `provider_id` text;
--> statement-breakpoint
ALTER TABLE `usage_events` ADD `model_id` text;
--> statement-breakpoint
CREATE INDEX `usage_events_provider_created_idx` ON `usage_events` (`provider_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `usage_events_provider_model_created_idx` ON `usage_events` (`provider_id`, `model_id`, `created_at`);
