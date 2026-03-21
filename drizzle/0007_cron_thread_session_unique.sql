ALTER TABLE `cron_job_definitions` ADD COLUMN `condition_module_path` text;
--> statement-breakpoint
ALTER TABLE `cron_job_definitions` ADD COLUMN `condition_description` text;
--> statement-breakpoint
ALTER TABLE `cron_job_definitions` ADD COLUMN `thread_session_id` text;
--> statement-breakpoint
ALTER TABLE `cron_job_instances` ADD COLUMN `agent_invoked` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `cron_job_definitions_thread_session_id_idx`
	ON `cron_job_definitions` (`thread_session_id`)
	WHERE `thread_session_id` IS NOT NULL AND TRIM(`thread_session_id`) <> '';
