CREATE TABLE `pending_personal_memory_vector_deletions` (
	`user_id` text NOT NULL,
	`memory_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `memory_id`)
);
