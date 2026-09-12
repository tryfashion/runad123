CREATE TABLE `runtime_heartbeats` (
	`name` varchar(100) NOT NULL,
	`last_seen_at` datetime(3) NOT NULL,
	`metadata_json` json NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `runtime_heartbeats_name` PRIMARY KEY(`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `job_attempts` (
	`id` char(36) character set ascii collate ascii_bin NOT NULL,
	`job_id` char(36) character set ascii collate ascii_bin NOT NULL,
	`attempt_no` int NOT NULL,
	`lease_token` char(36) character set ascii collate ascii_bin NOT NULL,
	`state` varchar(16) NOT NULL,
	`provider_request_id` varchar(256),
	`started_at` datetime(3) NOT NULL,
	`finished_at` datetime(3),
	`input_tokens` int,
	`output_tokens` int,
	`estimated_cost` decimal(20,6),
	`pricing_version` varchar(64) NOT NULL,
	`reconciled_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `job_attempts_id` PRIMARY KEY(`id`),
	CONSTRAINT `attempts_number` UNIQUE(`job_id`,`attempt_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `job_requests` (
	`id` char(36) character set ascii collate ascii_bin NOT NULL,
	`job_id` char(36) character set ascii collate ascii_bin NOT NULL,
	`draft_revision_id` char(36) character set ascii collate ascii_bin NOT NULL,
	`principal_type` varchar(16) NOT NULL,
	`principal_id` char(36) character set ascii collate ascii_bin NOT NULL,
	`installation_id` char(36) character set ascii collate ascii_bin NOT NULL,
	`client_action_id` char(36) character set ascii collate ascii_bin NOT NULL,
	`kind` varchar(16) NOT NULL,
	`state` varchar(16) NOT NULL,
	`payload_hash` binary(32) NOT NULL,
	`cache_hit` boolean NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `job_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `requests_idempotent` UNIQUE(`installation_id`,`client_action_id`,`kind`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` char(36) character set ascii collate ascii_bin NOT NULL,
	`kind` varchar(16) NOT NULL,
	`principal_type` varchar(16) NOT NULL,
	`principal_id` char(36) character set ascii collate ascii_bin NOT NULL,
	`installation_id` char(36) character set ascii collate ascii_bin NOT NULL,
	`draft_revision_id` char(36) character set ascii collate ascii_bin,
	`cache_key` binary(32) NOT NULL,
	`generation` int NOT NULL,
	`state` varchar(16) NOT NULL,
	`input_json` json,
	`result_json` json,
	`report_locale` varchar(16) NOT NULL,
	`model` varchar(100) NOT NULL,
	`prompt_version` varchar(64) NOT NULL,
	`schema_version` int NOT NULL,
	`attempts` int NOT NULL,
	`max_attempts` int NOT NULL,
	`next_run_at` datetime(3) NOT NULL,
	`lease_until` datetime(3),
	`lease_token` char(36) character set ascii collate ascii_bin,
	`worker_id` varchar(100),
	`started_at` datetime(3),
	`finished_at` datetime(3),
	`deadline_at` datetime(3) NOT NULL,
	`expires_at` datetime(3),
	`error_code` varchar(64),
	`input_tokens` int,
	`output_tokens` int,
	`estimated_cost` decimal(20,6),
	`pricing_version` varchar(64) NOT NULL,
	`quota_period_start` datetime(3) NOT NULL,
	`reserved_cost` decimal(20,6) NOT NULL,
	`config_json` json NOT NULL,
	`settled_at` datetime(3),
	`invalid_responses` int NOT NULL,
	`payload_purged_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `jobs_cache_generation` UNIQUE(`cache_key`,`generation`),
	CONSTRAINT `jobs_attempt_bound` CHECK(`jobs`.`attempts` between 0 and 3),
	CONSTRAINT `jobs_state` CHECK(`jobs`.`state` in ('queued','running','retry_wait','succeeded','failed','cancelled','blocked_auth'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE `usage_counters` (
	`id` char(36) character set ascii collate ascii_bin NOT NULL,
	`subject_type` varchar(16) NOT NULL,
	`subject_id` varchar(36) NOT NULL,
	`period_start` datetime(3) NOT NULL,
	`period_kind` varchar(16) NOT NULL,
	`operation` varchar(16) NOT NULL,
	`reserved_count` int NOT NULL,
	`started_count` int NOT NULL,
	`completed_count` int NOT NULL,
	`failed_count` int NOT NULL,
	`reserved_cost` decimal(20,6) NOT NULL,
	`estimated_cost` decimal(20,6) NOT NULL,
	`unknown_cost_count` int NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `usage_counters_id` PRIMARY KEY(`id`),
	CONSTRAINT `usage_subject_period` UNIQUE(`subject_type`,`subject_id`,`period_start`,`period_kind`,`operation`),
	CONSTRAINT `usage_nonnegative` CHECK(`usage_counters`.`reserved_count`>=0 and `usage_counters`.`reserved_cost`>=0 and `usage_counters`.`started_count`>=0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
ALTER TABLE `job_attempts` ADD CONSTRAINT `job_attempts_job_id_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `job_requests` ADD CONSTRAINT `job_requests_job_id_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `job_requests` ADD CONSTRAINT `job_requests_draft_revision_id_draft_revisions_id_fk` FOREIGN KEY (`draft_revision_id`) REFERENCES `draft_revisions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `job_requests` ADD CONSTRAINT `job_requests_installation_id_installations_id_fk` FOREIGN KEY (`installation_id`) REFERENCES `installations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `jobs` ADD CONSTRAINT `jobs_installation_id_installations_id_fk` FOREIGN KEY (`installation_id`) REFERENCES `installations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `jobs` ADD CONSTRAINT `jobs_draft_revision_id_draft_revisions_id_fk` FOREIGN KEY (`draft_revision_id`) REFERENCES `draft_revisions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `requests_job` ON `job_requests` (`job_id`);--> statement-breakpoint
CREATE INDEX `requests_revision` ON `job_requests` (`draft_revision_id`);--> statement-breakpoint
CREATE INDEX `requests_principal` ON `job_requests` (`principal_type`,`principal_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `jobs_ready` ON `jobs` (`state`,`next_run_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `jobs_lease` ON `jobs` (`state`,`lease_until`);--> statement-breakpoint
CREATE INDEX `jobs_principal` ON `jobs` (`principal_type`,`principal_id`,`created_at`);
--> statement-breakpoint
INSERT INTO settings (`key`,value_json,version,created_at,updated_at) VALUES ('ai_risk',JSON_OBJECT('enabled',false,'model','unconfigured','promptVersion','risk-v1','pricingVersion','unconfigured','inputPerMillion','0','outputPerMillion','0','dailyBudget','0','inputTokenBudget',90000,'outputTokens',4096,'contextTokens',100000,'anonymousDaily',10,'accountDaily',50),1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3));
