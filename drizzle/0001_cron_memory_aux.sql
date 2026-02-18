CREATE TABLE IF NOT EXISTS `message_memory_traces` (
	`message_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`trace_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `message_memory_traces_session_idx`
	ON `message_memory_traces` (`session_id`, `created_at` DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `cron_job_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`enabled` integer NOT NULL DEFAULT 1,
	`schedule_kind` text NOT NULL CHECK (`schedule_kind` IN ('at', 'every', 'cron')),
	`schedule_expr` text,
	`every_ms` integer,
	`at_iso` text,
	`timezone` text,
	`run_mode` text NOT NULL CHECK (`run_mode` IN ('system', 'agent', 'script')),
	`invoke_policy` text NOT NULL CHECK (`invoke_policy` IN ('never', 'always', 'on_condition')),
	`handler_key` text,
	`agent_prompt_template` text,
	`agent_model_override` text,
	`max_attempts` integer NOT NULL DEFAULT 3,
	`retry_backoff_ms` integer NOT NULL DEFAULT 30000,
	`payload_json` text NOT NULL DEFAULT '{}',
	`last_enqueued_for` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `cron_job_definitions_enabled_idx`
	ON `cron_job_definitions` (`enabled`, `schedule_kind`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `cron_job_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`job_definition_id` text NOT NULL REFERENCES `cron_job_definitions`(`id`) ON DELETE CASCADE,
	`scheduled_for` integer NOT NULL,
	`state` text NOT NULL CHECK (`state` IN ('queued', 'leased', 'running', 'completed', 'failed', 'dead')),
	`attempt` integer NOT NULL DEFAULT 0,
	`next_attempt_at` integer,
	`lease_owner` text,
	`lease_expires_at` integer,
	`last_heartbeat_at` integer,
	`result_summary` text,
	`error_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	UNIQUE(`job_definition_id`, `scheduled_for`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `cron_job_instances_ready_idx`
	ON `cron_job_instances` (`state`, `next_attempt_at`, `scheduled_for`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `cron_job_instances_job_idx`
	ON `cron_job_instances` (`job_definition_id`, `created_at` DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `cron_job_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`job_instance_id` text NOT NULL REFERENCES `cron_job_instances`(`id`) ON DELETE CASCADE,
	`step_kind` text NOT NULL CHECK (`step_kind` IN ('system', 'script', 'agent')),
	`status` text NOT NULL CHECK (`status` IN ('pending', 'running', 'completed', 'failed', 'skipped')),
	`input_json` text,
	`output_json` text,
	`error_json` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `cron_job_steps_instance_idx`
	ON `cron_job_steps` (`job_instance_id`, `created_at` ASC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `memory_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `memory_files` (
	`path` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL DEFAULT 'memory',
	`hash` text NOT NULL,
	`mtime` integer NOT NULL,
	`size` integer NOT NULL,
	`indexed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `memory_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`source` text NOT NULL DEFAULT 'memory',
	`start_line` integer NOT NULL,
	`end_line` integer NOT NULL,
	`hash` text NOT NULL,
	`text` text NOT NULL,
	`embedding_json` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `memory_chunks_path_idx` ON `memory_chunks` (`path`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `memory_chunks_updated_idx` ON `memory_chunks` (`updated_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `memory_embedding_cache` (
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`hash` text NOT NULL,
	`embedding_json` text NOT NULL,
	`dims` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`provider`, `model`, `hash`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `memory_embedding_cache_updated_idx`
	ON `memory_embedding_cache` (`updated_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `memory_records` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`type` text NOT NULL,
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
CREATE INDEX IF NOT EXISTS `memory_records_path_idx` ON `memory_records` (`path`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `memory_records_superseded_idx` ON `memory_records` (`superseded_by`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `memory_write_events` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`reason` text NOT NULL,
	`type` text NOT NULL,
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
CREATE INDEX IF NOT EXISTS `memory_write_events_created_idx`
	ON `memory_write_events` (`created_at` DESC);
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS `memory_chunks_fts` USING fts5(
	`text`,
	`chunk_id` UNINDEXED,
	`path` UNINDEXED,
	`start_line` UNINDEXED,
	`end_line` UNINDEXED,
	`updated_at` UNINDEXED
);
