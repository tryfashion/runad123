CREATE TABLE `admin_audit_logs` (
	`id` char(36) character set ascii collate ascii_bin NOT NULL,
	`admin_user_id` char(36) character set ascii collate ascii_bin NOT NULL,
	`action` varchar(64) NOT NULL,
	`target_type` varchar(32) NOT NULL,
	`target_id` varchar(64) NOT NULL,
	`before_json` json,
	`after_json` json,
	`request_id` char(36) character set ascii collate ascii_bin NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `admin_audit_logs_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `rate_limit_buckets` (
	`key_hash` binary(32) NOT NULL,
	`window_start` datetime(3) NOT NULL,
	`window_seconds` int NOT NULL,
	`count` int NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `rate_limit_buckets_key_hash_window_start_window_seconds_pk` PRIMARY KEY(`key_hash`,`window_start`,`window_seconds`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `auth_challenges` (
	`id` char(36) character set ascii collate ascii_bin NOT NULL,
	`email_normalized` varchar(254) NOT NULL,
	`installation_id` char(36) character set ascii collate ascii_bin,
	`pre_auth_hash` binary(32),
	`code_hmac` binary(32),
	`state` varchar(16) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`attempts` int NOT NULL,
	`consumed_at` datetime(3),
	`client_kind` varchar(16) NOT NULL,
	`delivery_locale` varchar(16) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `auth_challenges_id` PRIMARY KEY(`id`),
	CONSTRAINT `challenge_binding` CHECK((`auth_challenges`.`client_kind`='web' and `auth_challenges`.`pre_auth_hash` is not null and `auth_challenges`.`installation_id` is null) or (`auth_challenges`.`client_kind`='extension' and `auth_challenges`.`installation_id` is not null and `auth_challenges`.`pre_auth_hash` is null)),
	CONSTRAINT `challenge_state` CHECK(`auth_challenges`.`state` in ('pending','sent','failed')),
	CONSTRAINT `challenge_attempts` CHECK(`auth_challenges`.`attempts` between 0 and 5),
	CONSTRAINT `challenge_locale` CHECK(`auth_challenges`.`delivery_locale` in ('zh-Hans','zh-Hant','en'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `installations` (
	`id` char(36) character set ascii collate ascii_bin NOT NULL,
	`status` varchar(16) NOT NULL,
	`consent_version` varchar(32) NOT NULL,
	`consented_at` datetime(3) NOT NULL,
	`linked_user_id` char(36) character set ascii collate ascii_bin,
	`linked_at` datetime(3),
	`last_seen_at` datetime(3) NOT NULL,
	`extension_version` varchar(32) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `installations_id` PRIMARY KEY(`id`),
	CONSTRAINT `installations_status` CHECK(`installations`.`status` in ('active','disabled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` char(36) character set ascii collate ascii_bin NOT NULL,
	`token_hash` binary(32) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`installation_id` char(36) character set ascii collate ascii_bin,
	`user_id` char(36) character set ascii collate ascii_bin,
	`expires_at` datetime(3) NOT NULL,
	`last_seen_at` datetime(3) NOT NULL,
	`revoked_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `sessions_token_unique` UNIQUE(`token_hash`),
	CONSTRAINT `sessions_identity` CHECK((`sessions`.`kind`='anonymous' and `sessions`.`installation_id` is not null and `sessions`.`user_id` is null) or (`sessions`.`kind`='extension' and `sessions`.`installation_id` is not null and `sessions`.`user_id` is not null) or (`sessions`.`kind`='web' and `sessions`.`installation_id` is null and `sessions`.`user_id` is not null))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` varchar(64) NOT NULL,
	`value_json` json NOT NULL,
	`version` int NOT NULL,
	`updated_by` char(36) character set ascii collate ascii_bin,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `settings_key` PRIMARY KEY(`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `users` (
	`id` char(36) character set ascii collate ascii_bin NOT NULL,
	`email_normalized` varchar(254) NOT NULL,
	`email_display` varchar(254) NOT NULL,
	`role` varchar(16) NOT NULL,
	`status` varchar(16) NOT NULL,
	`last_login_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email_normalized`),
	CONSTRAINT `users_role` CHECK(`users`.`role` in ('user','admin')),
	CONSTRAINT `users_status` CHECK(`users`.`status` in ('active','disabled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
ALTER TABLE `admin_audit_logs` ADD CONSTRAINT `admin_audit_logs_admin_user_id_users_id_fk` FOREIGN KEY (`admin_user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `auth_challenges` ADD CONSTRAINT `auth_challenges_installation_id_installations_id_fk` FOREIGN KEY (`installation_id`) REFERENCES `installations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `installations` ADD CONSTRAINT `installations_linked_user_id_users_id_fk` FOREIGN KEY (`linked_user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_installation_id_installations_id_fk` FOREIGN KEY (`installation_id`) REFERENCES `installations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `settings` ADD CONSTRAINT `settings_updated_by_users_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_user_created` ON `admin_audit_logs` (`admin_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `buckets_expiry` ON `rate_limit_buckets` (`expires_at`);--> statement-breakpoint
CREATE INDEX `challenges_email_created` ON `auth_challenges` (`email_normalized`,`created_at`);--> statement-breakpoint
CREATE INDEX `installations_user` ON `installations` (`linked_user_id`);--> statement-breakpoint
CREATE INDEX `sessions_user_revoked` ON `sessions` (`user_id`,`revoked_at`);--> statement-breakpoint
CREATE INDEX `sessions_installation` ON `sessions` (`installation_id`);
--> statement-breakpoint
INSERT INTO settings (`key`,value_json,version,updated_by,created_at,updated_at) VALUES ('access_mode',JSON_QUOTE('anonymous_allowed'),1,NULL,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3));
