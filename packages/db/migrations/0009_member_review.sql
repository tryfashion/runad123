CREATE TABLE member_accounts (
 id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 email_normalized varchar(254) NOT NULL,
 password_salt binary(16) NOT NULL,
 password_hash binary(64) NOT NULL,
 password_version varchar(32) NOT NULL,
 purpose varchar(500) NOT NULL,
 state varchar(16) NOT NULL,
 user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
 reviewer_id char(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
 reviewed_at datetime(3) NULL,
 review_note varchar(500) NOT NULL,
 created_at datetime(3) NOT NULL,
 updated_at datetime(3) NOT NULL,
 UNIQUE KEY member_email(email_normalized),
 UNIQUE KEY member_user(user_id),
 KEY member_pending(state,id),
 CONSTRAINT member_state CHECK (state IN ('pending','approved','rejected')),
 CONSTRAINT member_approved_user CHECK ((state='approved' AND user_id IS NOT NULL) OR (state<>'approved' AND user_id IS NULL)),
 CONSTRAINT member_review_fields CHECK ((state='pending' AND reviewer_id IS NULL AND reviewed_at IS NULL) OR (state<>'pending' AND reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL)),
 FOREIGN KEY(user_id) REFERENCES users(id),
 FOREIGN KEY(reviewer_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

