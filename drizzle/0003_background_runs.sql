CREATE TABLE IF NOT EXISTS `background_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`runtime` text NOT NULL,
	`parent_session_id` text NOT NULL,
	`parent_external_session_id` text NOT NULL,
	`child_external_session_id` text NOT NULL,
	`requested_by` text NOT NULL DEFAULT 'system',
	`prompt` text NOT NULL DEFAULT '',
	`status` text NOT NULL DEFAULT 'created',
	`result_summary` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`parent_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CHECK (`status` IN ('created', 'running', 'retrying', 'idle', 'completed', 'failed', 'aborted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `background_runs_child_external_idx`
	ON `background_runs` (`runtime`, `child_external_session_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `background_runs_parent_created_idx`
	ON `background_runs` (`parent_session_id`, `created_at` DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `background_runs_status_updated_idx`
	ON `background_runs` (`status`, `updated_at` DESC);
