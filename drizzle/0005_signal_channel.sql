CREATE TABLE `channel_conversation_bindings` (
	`channel` text NOT NULL,
	`conversation_key` text NOT NULL,
	`session_id` text NOT NULL,
	`last_target` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`channel`, `conversation_key`),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `channel_conversation_bindings_session_idx` ON `channel_conversation_bindings` (`session_id`);
--> statement-breakpoint
CREATE INDEX `channel_conversation_bindings_updated_idx` ON `channel_conversation_bindings` (`updated_at`);
--> statement-breakpoint
CREATE TABLE `channel_pairing_requests` (
	`channel` text NOT NULL,
	`sender_id` text NOT NULL,
	`code` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`meta_json` text NOT NULL DEFAULT '{}',
	PRIMARY KEY(`channel`, `sender_id`)
);
--> statement-breakpoint
CREATE INDEX `channel_pairing_requests_code_idx` ON `channel_pairing_requests` (`channel`, `code`);
--> statement-breakpoint
CREATE INDEX `channel_pairing_requests_expires_idx` ON `channel_pairing_requests` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `channel_allowlist_entries` (
	`channel` text NOT NULL,
	`sender_id` text NOT NULL,
	`source` text NOT NULL DEFAULT 'pairing',
	`created_at` integer NOT NULL,
	PRIMARY KEY(`channel`, `sender_id`)
);
--> statement-breakpoint
CREATE INDEX `channel_allowlist_entries_channel_idx` ON `channel_allowlist_entries` (`channel`, `created_at`);
--> statement-breakpoint
CREATE TABLE `channel_inbound_dedupe` (
	`channel` text NOT NULL,
	`event_id` text NOT NULL,
	`seen_at` integer NOT NULL,
	PRIMARY KEY(`channel`, `event_id`)
);
--> statement-breakpoint
CREATE INDEX `channel_inbound_dedupe_seen_idx` ON `channel_inbound_dedupe` (`seen_at`);
