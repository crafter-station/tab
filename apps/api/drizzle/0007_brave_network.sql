CREATE TABLE `memory_extraction_operations` (
	`user_id` text NOT NULL,
	`batch_id_hash` text NOT NULL,
	`operation_index` integer NOT NULL,
	`outcome` text NOT NULL,
	`memory_id` text,
	`counted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `batch_id_hash`, `operation_index`)
);
--> statement-breakpoint
CREATE INDEX `idx_memory_extraction_operations_batch` ON `memory_extraction_operations` (`user_id`,`batch_id_hash`);--> statement-breakpoint
CREATE TABLE `pending_personal_memory_vector_upserts` (
	`user_id` text NOT NULL,
	`memory_id` text NOT NULL,
	`mutation_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `memory_id`)
);
--> statement-breakpoint
ALTER TABLE `memory_extraction_idempotency` ADD `operation_plan` text;--> statement-breakpoint
ALTER TABLE `memory_extraction_idempotency` ADD `operation_count` integer DEFAULT 0 NOT NULL;