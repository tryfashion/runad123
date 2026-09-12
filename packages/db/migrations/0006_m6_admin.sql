CREATE TABLE tutorials (
 id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,title varchar(200) NOT NULL,summary varchar(1000) NOT NULL,url varchar(2048) NOT NULL,content_locale varchar(16) NOT NULL,category varchar(32) NOT NULL,placement varchar(16) NOT NULL,sort_order int NOT NULL,enabled boolean NOT NULL,version int NOT NULL,created_at datetime(3) NOT NULL,updated_at datetime(3) NOT NULL,
 KEY tutorials_list(enabled,placement,content_locale,sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE data_deletions (
 id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,principal_type varchar(16) NOT NULL,principal_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,state varchar(16) NOT NULL,phase varchar(32) NOT NULL,progress_cursor varchar(64) NULL,created_at datetime(3) NOT NULL,updated_at datetime(3) NOT NULL,KEY deletions_pending(state,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
CREATE TABLE product_daily_stats (
 id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,day_utc datetime(3) NOT NULL,product_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,capture_count int NOT NULL,export_count int NOT NULL,anonymous_capture_actors int NOT NULL,account_capture_actors int NOT NULL,anonymous_export_actors int NOT NULL,account_export_actors int NOT NULL,created_at datetime(3) NOT NULL,updated_at datetime(3) NOT NULL,
 UNIQUE KEY daily_product_day(day_utc,product_id), FOREIGN KEY(product_id) REFERENCES source_products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
INSERT INTO settings (`key`,value_json,version,created_at,updated_at) VALUES
 ('admin_limits',JSON_OBJECT('allowedTutorialHosts',JSON_ARRAY()),1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
 ('retention',JSON_OBJECT('payloadDays',30,'eventDays',90,'aggregateDays',365,'auditDays',180),1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3));
