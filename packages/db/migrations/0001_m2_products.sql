CREATE TABLE `captures` (
	`id` char(36) character set ascii collate ascii_bin NOT NULL,
	`installation_id` char(36) character set ascii collate ascii_bin NOT NULL,
	`user_id_at_capture` char(36) character set ascii collate ascii_bin,
	`snapshot_id` char(36) character set ascii collate ascii_bin NOT NULL,
	`client_action_id` char(36) character set ascii collate ascii_bin NOT NULL,
	`payload_hash` binary(32) NOT NULL,
	`source_method` varchar(32) NOT NULL,
	`completeness` varchar(16) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `captures_id` PRIMARY KEY(`id`),
	CONSTRAINT `captures_action` UNIQUE(`installation_id`,`client_action_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `drafts` (
	`id` char(36) character set ascii collate ascii_bin NOT NULL,
	`capture_id` char(36) character set ascii collate ascii_bin NOT NULL,
	`installation_id` char(36) character set ascii collate ascii_bin NOT NULL,
	`user_id` char(36) character set ascii collate ascii_bin,
	`current_revision` int NOT NULL,
	`archived_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `drafts_id` PRIMARY KEY(`id`),
	CONSTRAINT `drafts_capture` UNIQUE(`capture_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `operation_events` (
	`id` char(36) character set ascii collate ascii_bin NOT NULL,
	`event_type` varchar(32) NOT NULL,
	`capture_id` char(36) character set ascii collate ascii_bin NOT NULL,
	`export_permit_id` char(36) character set ascii collate ascii_bin,
	`product_id` char(36) character set ascii collate ascii_bin NOT NULL,
	`installation_id` char(36) character set ascii collate ascii_bin NOT NULL,
	`user_id_at_event` char(36) character set ascii collate ascii_bin,
	`actor_key` varchar(38) NOT NULL,
	`client_event_id` char(36) character set ascii collate ascii_bin NOT NULL,
	`occurred_at` datetime(3) NOT NULL,
	`received_at` datetime(3) NOT NULL,
	`origin` varchar(16) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `operation_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `events_client` UNIQUE(`installation_id`,`client_event_id`),
	CONSTRAINT `events_permit_type` UNIQUE(`export_permit_id`,`event_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `draft_revisions` (
	`id` char(36) character set ascii collate ascii_bin NOT NULL,
	`draft_id` char(36) character set ascii collate ascii_bin NOT NULL,
	`revision` int NOT NULL,
	`prepared_product_json` json,
	`export_settings_json` json,
	`target_country` varchar(2) NOT NULL,
	`language` varchar(16) NOT NULL,
	`text_hash` binary(32) NOT NULL,
	`export_hash` binary(32) NOT NULL,
	`normalizer_version` int NOT NULL,
	`csv_mapping_version` int NOT NULL,
	`payload_purged_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `draft_revisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `draft_revisions_number` UNIQUE(`draft_id`,`revision`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `product_snapshots` (
	`id` char(36) character set ascii collate ascii_bin NOT NULL,
	`source_product_id` char(36) character set ascii collate ascii_bin NOT NULL,
	`content_hash` binary(32) NOT NULL,
	`schema_version` int NOT NULL,
	`product_json` json NOT NULL,
	`currency` varchar(3) NOT NULL,
	`market_country` varchar(2),
	`captured_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `product_snapshots_id` PRIMARY KEY(`id`),
	CONSTRAINT `snapshots_content` UNIQUE(`source_product_id`,`content_hash`,`schema_version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `source_products` (
	`id` char(36) character set ascii collate ascii_bin NOT NULL,
	`store_id` char(36) character set ascii collate ascii_bin NOT NULL,
	`source_product_id` varchar(32) NOT NULL,
	`handle` varchar(512) NOT NULL,
	`canonical_url` varchar(2048) NOT NULL,
	`latest_snapshot_id` char(36) character set ascii collate ascii_bin,
	`first_seen_at` datetime(3) NOT NULL,
	`last_seen_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `source_products_id` PRIMARY KEY(`id`),
	CONSTRAINT `source_product_store_id` UNIQUE(`store_id`,`source_product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `source_stores` (
	`id` char(36) character set ascii collate ascii_bin NOT NULL,
	`canonical_host` varchar(253) NOT NULL,
	`myshopify_host` varchar(253),
	`platform` varchar(16) NOT NULL,
	`first_seen_at` datetime(3) NOT NULL,
	`last_seen_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `source_stores_id` PRIMARY KEY(`id`),
	CONSTRAINT `source_stores_host` UNIQUE(`canonical_host`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
ALTER TABLE `captures` ADD CONSTRAINT `captures_installation_id_installations_id_fk` FOREIGN KEY (`installation_id`) REFERENCES `installations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `captures` ADD CONSTRAINT `captures_user_id_at_capture_users_id_fk` FOREIGN KEY (`user_id_at_capture`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `captures` ADD CONSTRAINT `captures_snapshot_id_product_snapshots_id_fk` FOREIGN KEY (`snapshot_id`) REFERENCES `product_snapshots`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `drafts` ADD CONSTRAINT `drafts_capture_id_captures_id_fk` FOREIGN KEY (`capture_id`) REFERENCES `captures`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `drafts` ADD CONSTRAINT `drafts_installation_id_installations_id_fk` FOREIGN KEY (`installation_id`) REFERENCES `installations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `drafts` ADD CONSTRAINT `drafts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `operation_events` ADD CONSTRAINT `operation_events_capture_id_captures_id_fk` FOREIGN KEY (`capture_id`) REFERENCES `captures`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `operation_events` ADD CONSTRAINT `operation_events_product_id_source_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `source_products`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `operation_events` ADD CONSTRAINT `operation_events_installation_id_installations_id_fk` FOREIGN KEY (`installation_id`) REFERENCES `installations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `operation_events` ADD CONSTRAINT `operation_events_user_id_at_event_users_id_fk` FOREIGN KEY (`user_id_at_event`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `draft_revisions` ADD CONSTRAINT `draft_revisions_draft_id_drafts_id_fk` FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_snapshots` ADD CONSTRAINT `product_snapshots_source_product_id_source_products_id_fk` FOREIGN KEY (`source_product_id`) REFERENCES `source_products`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `source_products` ADD CONSTRAINT `source_products_store_id_source_stores_id_fk` FOREIGN KEY (`store_id`) REFERENCES `source_stores`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `captures_snapshot_time` ON `captures` (`snapshot_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `captures_user_time` ON `captures` (`user_id_at_capture`,`created_at`);--> statement-breakpoint
CREATE INDEX `drafts_installation_time` ON `drafts` (`installation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `drafts_user_time` ON `drafts` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `events_type_time_product_actor` ON `operation_events` (`event_type`,`received_at`,`product_id`,`actor_key`);--> statement-breakpoint
CREATE INDEX `events_product_time` ON `operation_events` (`product_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `revision_text_hash` ON `draft_revisions` (`text_hash`);--> statement-breakpoint
CREATE INDEX `source_product_seen` ON `source_products` (`last_seen_at`);