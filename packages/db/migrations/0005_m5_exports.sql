CREATE TABLE export_permits (
 id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY, draft_revision_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, risk_request_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 principal_type varchar(16) NOT NULL, principal_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, installation_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 export_hash binary(32) NOT NULL, assessment varchar(32) NOT NULL, severity varchar(16) NOT NULL,
 acknowledged_findings_json json NOT NULL, acknowledged_at datetime(3) NULL, expires_at datetime(3) NOT NULL,
 client_action_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, payload_hash binary(32) NOT NULL, created_at datetime(3) NOT NULL,
 UNIQUE KEY permits_action(installation_id,client_action_id), KEY permits_revision(draft_revision_id,created_at),
 FOREIGN KEY(draft_revision_id) REFERENCES draft_revisions(id), FOREIGN KEY(risk_request_id) REFERENCES job_requests(id), FOREIGN KEY(installation_id) REFERENCES installations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
--> statement-breakpoint
ALTER TABLE operation_events ADD CONSTRAINT events_permit_fk FOREIGN KEY(export_permit_id) REFERENCES export_permits(id);
