CREATE TABLE admin_credentials (
 user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 login_normalized varchar(254) NOT NULL,
 password_salt binary(16) NOT NULL,
 password_hash binary(64) NOT NULL,
 password_version varchar(32) NOT NULL,
 created_at datetime(3) NOT NULL,
 updated_at datetime(3) NOT NULL,
 UNIQUE KEY admin_credentials_login(login_normalized),
 FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
