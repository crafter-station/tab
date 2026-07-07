CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_account_user_id` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `device_exchange_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `device_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`platform` text NOT NULL,
	`app_version` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`revoked` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_tokens_device_id_unique` ON `device_tokens` (`device_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `device_tokens_token_hash_unique` ON `device_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_device_tokens_user` ON `device_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `personal_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`content` text NOT NULL,
	`category` text NOT NULL,
	`source` text NOT NULL,
	`sensitivity` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_personal_memories_user` ON `personal_memories` (`user_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `idx_session_user_id` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `telemetry_events` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`user_id` text NOT NULL,
	`device_id` text,
	`event_type` text NOT NULL,
	`timestamp` text NOT NULL,
	`active_application_bundle_id` text,
	`context_source` text,
	`suggestion_length` integer,
	`plan_id` text,
	`model_id` text,
	`latency_ms` integer,
	`error_code` text,
	`memory_eligible` integer,
	`redaction_applied` integer,
	`redaction_count` integer,
	`client_app_version` text,
	`client_platform` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_telemetry_events_user` ON `telemetry_events` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_telemetry_events_request` ON `telemetry_events` (`request_id`);--> statement-breakpoint
CREATE TABLE `usage_records` (
	`user_id` text NOT NULL,
	`month` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `month`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `user_entitlements` (
	`user_id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`polar_customer_id` text,
	`polar_subscription_id` text,
	`status` text NOT NULL,
	`current_period_end` text,
	`cached_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
