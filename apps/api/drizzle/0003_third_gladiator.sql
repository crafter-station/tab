CREATE TABLE `memory_extraction_idempotency` (
	`user_id` text NOT NULL,
	`batch_id_hash` text NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	`deleted` integer NOT NULL,
	`rejected` integer NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `batch_id_hash`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_memory_extraction_idempotency_expires` ON `memory_extraction_idempotency` (`expires_at`);