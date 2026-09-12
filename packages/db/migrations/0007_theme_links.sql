INSERT INTO settings (`key`,value_json,version,created_at,updated_at) VALUES ('theme_links',JSON_ARRAY(),1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE `key` = 'theme_links';
