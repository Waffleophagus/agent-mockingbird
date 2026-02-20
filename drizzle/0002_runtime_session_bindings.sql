CREATE TABLE IF NOT EXISTS `runtime_session_bindings` (
	`runtime` text NOT NULL,
	`session_id` text NOT NULL,
	`external_session_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`runtime`, `session_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `runtime_session_bindings_external_idx`
	ON `runtime_session_bindings` (`runtime`, `external_session_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `runtime_session_bindings_updated_idx`
	ON `runtime_session_bindings` (`updated_at`);
--> statement-breakpoint
INSERT INTO `runtime_session_bindings` (`runtime`, `session_id`, `external_session_id`, `updated_at`)
SELECT
	substr(j.key, 1, instr(j.key, ':') - 1) AS runtime,
	substr(j.key, instr(j.key, ':') + 1) AS session_id,
	CAST(j.value AS TEXT) AS external_session_id,
	CAST(strftime('%s', 'now') * 1000 AS INTEGER) AS updated_at
FROM `runtime_config` rc
JOIN json_each(rc.value_json) j
WHERE rc.`key` = 'sessionBindings'
	AND instr(j.key, ':') > 0
	AND trim(CAST(j.value AS TEXT)) <> ''
ON CONFLICT(`runtime`, `session_id`) DO UPDATE SET
	`external_session_id` = excluded.`external_session_id`,
	`updated_at` = excluded.`updated_at`;
