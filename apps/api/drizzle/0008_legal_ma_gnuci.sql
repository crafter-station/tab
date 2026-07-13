CREATE TABLE `allowance_usage_events` (
	`user_id` text NOT NULL,
	`metric` text NOT NULL,
	`event_id` text NOT NULL,
	`period` text NOT NULL,
	`amount` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `metric`, `event_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_allowance_usage_period` ON `allowance_usage_events` (`user_id`,`metric`,`period`);--> statement-breakpoint
ALTER TABLE `telemetry_events` ADD `inference_source` text;--> statement-breakpoint
ALTER TABLE `telemetry_events` ADD `trigger` text;--> statement-breakpoint
ALTER TABLE `telemetry_events` ADD `accepted_word_count` integer;--> statement-breakpoint
ALTER TABLE `telemetry_events` ADD `accepted_character_count` integer;--> statement-breakpoint
ALTER TABLE `telemetry_events` ADD `application_category` text;--> statement-breakpoint
ALTER TABLE `telemetry_events` ADD `memory_used` integer;--> statement-breakpoint
ALTER TABLE `telemetry_events` ADD `memory_count` integer;--> statement-breakpoint
ALTER TABLE `telemetry_events` ADD `provider_id` text;--> statement-breakpoint
ALTER TABLE `telemetry_events` ADD `cloud_cost_usd_micros` integer;--> statement-breakpoint
CREATE INDEX `idx_telemetry_events_source_time` ON `telemetry_events` (`user_id`,`inference_source`,`timestamp`);--> statement-breakpoint
ALTER TABLE `user_entitlements` ADD `billing_interval` text;--> statement-breakpoint
ALTER TABLE `user_entitlements` ADD `trial_started_at` text;--> statement-breakpoint
ALTER TABLE `user_entitlements` ADD `trial_ends_at` text;--> statement-breakpoint
ALTER TABLE `user_entitlements` ADD `last_webhook_event_id` text;--> statement-breakpoint
ALTER TABLE `user_entitlements` ADD `last_webhook_occurred_at` text;--> statement-breakpoint
CREATE INDEX `idx_device_tokens_user_revoked` ON `device_tokens` (`user_id`,`revoked`);