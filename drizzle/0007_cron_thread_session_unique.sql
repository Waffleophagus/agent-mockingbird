CREATE UNIQUE INDEX IF NOT EXISTS `cron_job_definitions_thread_session_id_idx`
	ON `cron_job_definitions` (`thread_session_id`)
	WHERE `thread_session_id` IS NOT NULL AND TRIM(`thread_session_id`) <> '';
