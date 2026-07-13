DROP INDEX `device_tokens_device_id_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_device_tokens_user_device` ON `device_tokens` (`user_id`,`device_id`);