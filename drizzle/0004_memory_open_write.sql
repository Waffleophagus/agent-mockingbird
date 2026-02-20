PRAGMA foreign_keys=OFF;
--> statement-breakpoint
DROP TABLE IF EXISTS `memory_records_new`;
--> statement-breakpoint
CREATE TABLE `memory_records_new` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`source` text NOT NULL,
	`content` text NOT NULL,
	`entities_json` text NOT NULL,
	`confidence` real NOT NULL,
	`supersedes_json` text NOT NULL,
	`superseded_by` text,
	`recorded_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `memory_records_new` (
	`id`, `path`, `source`, `content`, `entities_json`, `confidence`, `supersedes_json`, `superseded_by`, `recorded_at`, `updated_at`
)
SELECT
	`id`, `path`, `source`, `content`, `entities_json`, `confidence`, `supersedes_json`, `superseded_by`, `recorded_at`, `updated_at`
FROM `memory_records`;
--> statement-breakpoint
DROP TABLE `memory_records`;
--> statement-breakpoint
ALTER TABLE `memory_records_new` RENAME TO `memory_records`;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `memory_records_path_idx` ON `memory_records` (`path`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `memory_records_superseded_idx` ON `memory_records` (`superseded_by`);
--> statement-breakpoint
DROP TABLE IF EXISTS `memory_write_events_new`;
--> statement-breakpoint
CREATE TABLE `memory_write_events_new` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`reason` text NOT NULL,
	`source` text NOT NULL,
	`content` text NOT NULL,
	`confidence` real NOT NULL,
	`session_id` text,
	`topic` text,
	`record_id` text,
	`path` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `memory_write_events_new` (
	`id`, `status`, `reason`, `source`, `content`, `confidence`, `session_id`, `topic`, `record_id`, `path`, `created_at`
)
SELECT
	`id`, `status`, `reason`, `source`, `content`, `confidence`, `session_id`, `topic`, `record_id`, `path`, `created_at`
FROM `memory_write_events`;
--> statement-breakpoint
DROP TABLE `memory_write_events`;
--> statement-breakpoint
ALTER TABLE `memory_write_events_new` RENAME TO `memory_write_events`;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `memory_write_events_created_idx`
	ON `memory_write_events` (`created_at` DESC);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
