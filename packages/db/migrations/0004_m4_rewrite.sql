UPDATE usage_counters SET operation='ai' WHERE subject_type='global' AND operation='risk_check';
--> statement-breakpoint
INSERT INTO settings (`key`,value_json,version,created_at,updated_at) VALUES ('ai_rewrite',JSON_OBJECT('enabled',false,'model','unconfigured','promptVersion','rewrite-v1','pricingVersion','unconfigured','inputPerMillion','0','outputPerMillion','0','dailyBudget','0','inputTokenBudget',90000,'outputTokens',8192,'contextTokens',100000,'anonymousDaily',5,'accountDaily',20),1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3));
