CREATE TABLE `polar_usage_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`event_name` text NOT NULL,
	`event_timestamp` text NOT NULL,
	`metadata` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text NOT NULL,
	`lease_owner` text,
	`lease_expires_at` text,
	`delivered_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_polar_usage_outbox_pending` ON `polar_usage_outbox` (`status`,`next_attempt_at`);--> statement-breakpoint
ALTER TABLE `user_entitlements` ADD `polar_product_id` text;--> statement-breakpoint
ALTER TABLE `user_entitlements` ADD `current_period_start` text;--> statement-breakpoint
ALTER TABLE `user_entitlements` ADD `cancel_at_period_end` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user_entitlements` ADD `provisioning_state` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_entitlements` ADD `provisioning_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_entitlements` ADD `provisioning_error` text;--> statement-breakpoint
ALTER TABLE `user_entitlements` ADD `provisioning_updated_at` text;--> statement-breakpoint
ALTER TABLE `user_entitlements` ADD `reconciled_at` text;