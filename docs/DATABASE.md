# MySQL 8 数据规格

本文定义逻辑表和约束。M1–M5 已有 Drizzle schema、显式 SQL migration 和真实 MySQL 本地集成证据；尚未实施的表在后续阶段落地，不能省略下面的唯一约束和事务要求。

## 1. 全局约定

- InnoDB、utf8mb4；时间用 UTC `DATETIME(3)`，连接 session 设置 UTC；界面转换显示时区。
- 内部 ID 使用应用生成的 UUID 字符串，`CHAR(36)` ASCII binary collation。外部 Shopify ID 用 `VARCHAR(32)` 字符串，不能强制 JavaScript number。
- SHA-256 摘要用 `BINARY(32)`；API 传小写 hex。会话原始令牌至少 32 随机字节，数据库只存摘要。
- 金额用 `DECIMAL(20,6)` 或 JSON 十进制字符串；费用估算 `DECIMAL(20,6)`；不可用 FLOAT 存金额。
- 所有表有 `created_at`，可变实体另有 `updated_at`。数据库外键采用 RESTRICT，删除走明确服务，不做无边界级联。
- URL 不直接建立长唯一索引。存规范化 URL 和 hash，碰到相同 hash 时核对原文；URL 最长 2048 字符。
- 查询全部参数化，列表使用游标分页，默认 20，最多 100。交易表不能让未授权用户自由指定 owner ID。
- 枚举用 varchar＋应用 schema＋必要 CHECK；不要靠任何客户端字符串直接拼接 SQL。

## 2. 身份与管理

| 表 | 关键字段 | 必需约束/索引 |
| --- | --- | --- |
| users | id、email_normalized、email_display、role(user/admin)、status(active/disabled)、last_login_at | UNIQUE(email_normalized)；role 不来自公开注册请求 |
| member_accounts | id、email_normalized、password_salt BINARY(16)、password_hash BINARY(64)、password_version、purpose、state、user_id nullable、reviewer_id nullable、reviewed_at nullable、review_note | UNIQUE(email_normalized)、UNIQUE(user_id)；INDEX(state,id)；用户/审核人 FK users；状态与关联字段 CHECK，见下文 |
| installations | id、status、consent_version、consented_at、linked_user_id nullable、linked_at、last_seen_at、extension_version | INDEX(linked_user_id)；linked_user_id 只记录明确同意的历史归属关联 |
| sessions | id、token_hash、kind(anonymous/extension/web)、installation_id nullable、user_id nullable、expires_at、last_seen_at、revoked_at | UNIQUE(token_hash)；INDEX(user_id,revoked_at)；匿名必须有 installation，无 user |
| auth_challenges | id、email_normalized、installation_id nullable、pre_auth_hash nullable、code_hmac nullable（消费后清除）、state(pending/sent/failed)、expires_at、attempts、consumed_at、client_kind、delivery_locale | INDEX(email_normalized,created_at)；仅 sent 可验证，校验/消费事务化，一次性使用；邮件语言创建时冻结 |
| rate_limit_buckets | key_hash、window_start、window_seconds、count、expires_at | UNIQUE(key_hash,window_start,window_seconds)；INDEX(expires_at)，原子计数 |
| settings | key、value_json、version、updated_by | UNIQUE(key)；后台只能更新服务端白名单及已验证类型 |
| tutorials | id、title、summary、url、content_locale、category、placement、sort_order、enabled | INDEX(enabled,placement,content_locale,sort_order)；HTTPS＋允许域名校验；每行一篇原语言文章 |
| admin_audit_logs | id、admin_user_id、action、target_type、target_id、before_json、after_json、request_id | INDEX(admin_user_id,created_at)；排除密钥、验证码和令牌 |
| admin_credentials | user_id、login_normalized、password_salt、password_hash、password_version | PK(user_id)；UNIQUE(login_normalized)；仅内部管理员密码登录使用，保存 scrypt salt/hash，不保存明文 |

匿名会话有效期初始 90 天，登录插件会话 30 天，网站会话 7 天；过期重新认证。匿名/插件续期只凭仍有效的会话延长现有 token 有效期，不更换 token，不可凭 installation ID 领回旧身份。同意关联历史时撤销该安装的匿名会话；退出撤销当前登录会话，已关联安装建立新的匿名上下文，未关联安装才可恢复仍有效的原匿名凭据，不把用户数据暴露给匿名态。禁用/撤销优先于续期，且不能使过期会话复活。

邮箱规范化：去首尾空格、小写，不改 Gmail 点号/加号。当前邮箱只是未验证的登录名，不作为所有权证明；重复申请不泄露已有账号状态，不覆盖密码或接管 users。旧邮箱验证码 HTTP 端点已停用。

M1 落地约定：首个迁移为 packages/db/migrations/0000_m1_identity.sql，仅建 users、installations、sessions、auth_challenges、rate_limit_buckets、settings、admin_audit_logs；tutorials 在教程阶段迁移。初始 settings 仅 access_mode=anonymous_allowed，版本 1。表使用 utf8mb4_0900_bin，邮箱由应用先小写匹配；摘要通过 Drizzle 自定义 Buffer 类型读写，禁止 UTF-8 字符串转换损坏二进制。

迁移命令要求已有 MySQL 8.0.16+（CHECK 实际执行）及 STRICT 模式；连接 UTC。runad_migrations 运维表记录 name/checksum/state/created_at/updated_at，GET_LOCK 防并发；每个文件先记 applying、全部执行后改 applied，成功重跑跳过，checksum 改变或遗留 applying 均停止人工复核。MySQL DDL 隐式提交，失败不能宣称完整回滚。迁移不自动建库、不自动 push。

M1 身份事务统一先锁 settings.access_mode 行，序列化安装、验证码消费、会话和限速计数，避免并发绕过及反向锁序。密码哈希和遗留 SMTP 网络调用在事务之外；审核和会话签发事务内重新检查状态。该策略适用于初期低流量，吞吐和锁等待必须实测；后续商品/AI 事务不能持有此锁再按另一顺序进入身份服务。单次身份查找最多 100 行，按创建时间倒序；并非批量后台列表接口。

### member_accounts 注册审核（迁移 0009）

- 注册申请仅创建 pending 行，purpose 未提供时为空字符串，提供时为 5–500 字符；密码至少 8 字符，独立随机盐及 scrypt-v1 哈希，不保存明文。email_normalized 最长 254，review_note 最长 500。
- state 只允许 pending/approved/rejected。CHECK：approved 必须有 user_id，其余状态必须为空；pending 的 reviewer_id/reviewed_at 必须为空，其余状态均非空。
- 批准时在同一身份锁事务内确认 pending、检查已有邮箱冲突、创建 active 普通 user、填审核人/时间并写 member.review 审计；拒绝不创建 user。并发审核只允许一个成功，其余冲突。唯一邮箱约束防止并发重复申请。
- 未验证邮箱不自动关联旧账号。新密码登录重新核验 user active；密码验证成功前不泄露审批状态。数据列表不返回盐、哈希；审核备注仅管理员可见。
- 无邮件通知、自助重提、密码找回。申请/审批记录当前保留供人工审核；现有“删除我的数据”删除业务草稿/采集，不是销户，不删除身份凭据。销户和申请记录保留政策需单独实现。
- 既有邮箱验证码表作为历史兼容保留，公开 HTTP 禁用，不能成为绕过审核的入口。M1 的历史关联能力仍保留内部实现，本次密码注册不启用。
- 本地迁移验证需要运行 node --env-file-if-exists=.env.test --import tsx scripts/test-member-mysql.ts，仅允许 runad123_test 或 runad123_test_ 后缀测试库，不创建/删除数据库。

## 3. 商品、采集和草稿

| 表 | 关键字段 | 必需约束/索引 |
| --- | --- | --- |
| source_stores | id、canonical_host、myshopify_host nullable、platform、first_seen_at、last_seen_at | UNIQUE(canonical_host)；域名小写、IDNA 规范化、无端口/路径 |
| source_products | id、store_id、source_product_id、handle、canonical_url、latest_snapshot_id nullable、first_seen_at、last_seen_at | UNIQUE(store_id,source_product_id)；INDEX(last_seen_at) |
| product_snapshots | id、source_product_id(FK)、content_hash、schema_version、product_json、currency、market_country nullable、captured_at | UNIQUE(source_product_id,content_hash,schema_version)；商品 JSON 不含用户身份 |
| captures | id、installation_id、user_id_at_capture nullable、snapshot_id、client_action_id、payload_hash、source_method、completeness、created_at | UNIQUE(installation_id,client_action_id)；INDEX(snapshot_id,created_at)；INDEX(user_id_at_capture,created_at) |
| drafts | id、capture_id、installation_id、user_id nullable、current_revision、archived_at | UNIQUE(capture_id)；INDEX(installation_id,created_at)；INDEX(user_id,created_at) |
| draft_revisions | id、draft_id、revision、prepared_product_json nullable、export_settings_json nullable、target_country、language、text_hash、export_hash、normalizer_version、csv_mapping_version、payload_purged_at nullable | UNIQUE(draft_id,revision)；INDEX(text_hash)；业务内容不可修改，保留期满只允许清除 payload |

说明：

- M2 `prepared_product_json` 保存完整 PreparedDraftRevision 冻结信封（包含 preparedProduct、descriptionText、sourceSummary、warnings、版本与哈希），读取时用共享 schema 校验；export_settings_json 与同一信封设置一致，在同一事务写入。正文清理时两份 JSON 一并置空。
- M2 已创建 source_stores、source_products、product_snapshots、captures、drafts、draft_revisions、operation_events。0001 建表，0002 为 source_products.latest_snapshot_id 添加 RESTRICT 外键；新建商品先空引用再写快照。operation_events.export_permit_id 暂为 NULL，M5 创建许可表后加外键；M2 只写服务端 capture_created 事件。
- `product_snapshots.source_product_id` 指内部 source_products.id；Shopify 原始 ID 位于 source_products.source_product_id，实现中可将前者属性名写为 `productId` 避免混淆。
- 首版完整采集必须有稳定商品 ID。结构化数据回退只够预览时，不写正式 source_products/captures，不进入热度统计。
- 商品事实快照和用户草稿分开，AI 改写不能污染来源商品或其他人的快照。
- 服务端对 URL/domain/ID 和 schema 作一致性校验，但来自插件的数据仍不是店铺官方认证数据；不能声称防伪完整。
- 同商品同内容快照去重，但每次明确采集动作有独立 capture；网络重试通过 client_action_id 去重。
- 快照 content_hash 只包括规范化商品事实、市场、币种及 schema 版本，不包含 capturedAt、请求 ID、采集方法或用户信息；否则时间差会破坏内容去重。
- 草稿更新采用 `expectedRevision` 乐观并发控制。更新失败返回 409，不自动覆盖另一个面板的编辑。
- 服务端净化、规范化及 CSV 文本安全处理完成后生成不可变 revision；AI 输入和导出都引用该 revision。
- user_id_at_capture 是发生时事实，不因日后登录回写。用户同意关联后通过 installations.linked_user_id 授予历史访问权；事件历史身份口径仍保留。关联账号后不能由另一个账号重新关联；账号退出后建立新的匿名安装上下文供新匿名采集，旧关联身份不降级公开给匿名态。

## 4. 任务、额度与导出

| 表 | 关键字段 | 必需约束/索引 |
| --- | --- | --- |
| jobs | id、kind、principal_type、principal_id、installation_id、draft_revision_id nullable、cache_key、generation、state、input_json nullable、result_json nullable、report_locale、model、prompt_version、schema_version、attempts、max_attempts、next_run_at、lease_until、lease_token、worker_id、started_at、finished_at、deadline_at、expires_at nullable、error_code、input_tokens、output_tokens、estimated_cost、pricing_version、quota_period_start、reserved_cost、config_json、settled_at nullable、invalid_responses、payload_purged_at nullable | UNIQUE(cache_key,generation)；INDEX(state,next_run_at,created_at)；INDEX(state,lease_until)；INDEX(principal_type,principal_id,created_at) |
| job_requests | id、job_id、draft_revision_id、principal_type、principal_id、installation_id、client_action_id、kind、state、payload_hash、cache_hit | UNIQUE(installation_id,client_action_id,kind)；INDEX(job_id)；INDEX(principal_type,principal_id,created_at) |
| job_attempts | id、job_id、attempt_no、lease_token、state(started/succeeded/failed/unknown)、provider_request_id nullable、started_at、finished_at nullable、input_tokens nullable、output_tokens nullable、estimated_cost nullable、pricing_version、reconciled_at nullable | UNIQUE(job_id,attempt_no)；每次外呼前持久写 started 并递增 jobs.attempts，崩溃算一次尝试 |
| usage_counters | id、subject_type、subject_id、period_start、period_kind、operation、reserved_count、started_count、completed_count、failed_count、reserved_cost、estimated_cost、unknown_cost_count | UNIQUE(subject_type,subject_id,period_start,period_kind,operation) |
| export_permits | id、draft_revision_id、risk_request_id(FK job_requests.id)、principal_type、principal_id、installation_id、export_hash、assessment、severity、acknowledged_findings_json、acknowledged_at nullable、expires_at、client_action_id、payload_hash | UNIQUE(installation_id,client_action_id)；INDEX(draft_revision_id,created_at) |
| operation_events | id、event_type、capture_id、export_permit_id nullable、product_id、installation_id、user_id_at_event nullable、actor_key、client_event_id、occurred_at、received_at、origin | UNIQUE(installation_id,client_event_id)；UNIQUE(export_permit_id,event_type)；INDEX(event_type,received_at,product_id,actor_key)；INDEX(product_id,received_at) |
| product_daily_stats | day_utc、product_id、capture_count、export_completed_count、anonymous_capture_actors、account_capture_actors、anonymous_export_actors、account_export_actors、calculated_at | PRIMARY KEY(day_utc,product_id)；单日统计，不用于直接相加求多日 distinct |
| runtime_heartbeats | name、last_seen_at、metadata_json | PRIMARY KEY(name)；worker 健康及统计刷新时间 |

M5 的 0005 已落库 export_permits，并约束 operation_events.export_permit_id 外键。

M3 已落库 jobs、job_requests、job_attempts、usage_counters、runtime_heartbeats；0003 显式迁移插入 disabled 的 settings.ai_risk。M4 的 0004 插入默认 disabled 的 settings.ai_rewrite，并把既有 global/risk_check 额度行的 operation 更新为 ai，保留全部计数和费用；没有新增表。升级时先停 API/worker，再迁移并用新代码重启，不能混跑使用旧全局计费键的 M3 worker。

settings.ai_risk 和 ai_rewrite 分别保存 enabled/model/promptVersion/pricingVersion/inputPerMillion/outputPerMillion/inputTokenBudget/outputTokens/contextTokens/anonymousDaily/accountDaily；prompt 固定 risk-v1、rewrite-v1。全局 USD 日预算以 ai_risk.dailyBudget 为唯一生效来源，rewrite 配置中的 dailyBudget 字段不构成另一份预算。改写默认匿名 5 次/账号 20 次，风险默认 10/50 次，均按 UTC 日；改写输出 cap 默认 8192，供应商实际支持值需配置前核验。global/all/day 的 usage_counters.operation 固定 ai，两类任务的费用预留、已知费用、unknown 占用累计到同一行；主体 operation 分别为 risk_check/rewrite，计算次数独立。jobs.config_json 冻结非敏感模型/价格/预算配置，不保存 API key；settled_at 保证任务结果计数只结算一次，invalid_responses 限制最多一次结构修复。价格及费用是 decimal(20,6) 字符串（USD），计算使用整数微美元向上取整。job_requests.cache_hit 指创建时是否命中成功结果。

M3 延续 M1 的 access_mode 配置行作为业务事务的统一前置锁；随后按全局额度→当前账号或匿名安装额度→job→attempt 顺序更新。当前登录计算额度只计账号，安装限速使用独立桶。claimJob/renewJob 不取得此前置锁，只短暂锁 job，领取 SELECT FOR UPDATE SKIP LOCKED；跨额度的开始/结算进入新事务。前置锁仍是吞吐限制，未做生产规模压测，后续不得未经验证直接拆锁。

jobs 同时保存 AI 结果，首版不再添加独立风险和改写结果表。result_json 用按 kind 区分的 Zod schema，不能存任意无验证模型文本作为成功结果。

jobs.report_locale 记录模型解释/建议语言并纳入 canonical_input_hash；它与 draft_revisions.language（商品输出语言）不同。界面语言偏好首版存客户端，不新增用户偏好表，不因切换 UI 更新草稿或使检查失效。

draft_revisions.language 为 preserve/zh-Hans/zh-Hant/en，默认 preserve；report_locale 为 zh-Hans/zh-Hant/en，不允许 preserve。两字段分别校验，UI 偏好 auto 不可写进任一 AI 字段。

`cache_key` 为 `principal_type + principal_id + kind + canonical_input_hash + model + prompt_version + schema_version` 的 SHA-256。仅同主体复用。成功结果最长有效 7 天；排队或运行中的同输入直接挂接 request；过期、终态失败后显式重试时创建 generation+1。创建事务按下文统一顺序锁额度行，再查询同 key 最新 generation 并插入；终态失败不自动形成无限新 generation。

job_requests 对外使用 aiRequestId，内部 job ID 不暴露。缓存命中也创建调用者自己的 request，且关联其草稿 revision；请求权限按 CONTRACTS 的统一资源规则判断。export_permits 关联的是已校验权限的 risk_request_id，再由 request 找 job，不能只保存底层 job 而丢失检查授权链。

首版缓存不跨不同主体复用。同安装从匿名转登录后，新计算使用账号 key；已完成且仍有效的匿名结果仅能通过有权访问的原 request 继续使用。blocked_auth 恢复时以当前登录主体创建新 request/job，旧任务终止且不迁移已结算额度。

额度：按主体限制已发起新计算数，同时按安装/IP 指纹限制请求速率；同主体成功缓存命中不扣 AI 计算次数，但计入业务调用次数。创建新 job 与预留额度同一事务；确认缓存命中则不预留。所有同时修改额度和任务的事务按全局额度→账号额度（若有）→安装额度→job→attempt 的顺序加锁，同类多行按主键排序，失败回滚。worker 单独领取/续租只锁 job 并立即提交；不得持着 job 锁再进入额度事务。领取之后的额度操作使用新事务，并重新校验 lease，防止反向锁序死锁。

登录额度按账号；匿名额度按安装；服务端还有全局日预算。worker 首次发出调用时将 reserved_count 转 started_count；后续成功/失败分别累加结果计数，不能再次扣 started_count。供应商多次尝试 token/cost 累计；发出调用后失败不退计算次数，未发出即取消/阻塞才释放预留。费用预留按最大输入/输出及最大尝试数估计，实际结算后释放差额；用量未知时保留保守费用占用至人工校正。跨 UTC 日任务按预留所属日结算，防止午夜漏扣。必要的逐次诊断放受控结构化日志，不保存输入正文。

captures、export_permits 和 job_requests 的 payload_hash 用于同 key 比对；不能只依赖唯一 key 返回任意旧内容。

jobs.quota_period_start 和 reserved_cost 用于跨日、重试和崩溃恢复后的幂等结算；worker 状态变更以持有 lease_token 和预期旧状态为条件。未被领取的取消/阻塞事务按预期状态判断，不要求不存在的 worker token。deadline_at 初始为创建后 24 小时，超过期限终止为 failed/TASK_EXPIRED 并结算；expires_at 只表示成功结果缓存到期，成功时设 finished_at＋7 天，未成功为 null。执行期限与缓存有效期不能混用。

job_attempts 是费用审计的权威明细，日志不是账本。外呼响应丢失的 attempt 保持 unknown，不填零；只有当前 lease 能发布业务结果，迟到响应可按原 attempt ID 补记费用但不能覆盖新结果。结算以 attempt ID＋reconciled_at 幂等执行；总尝试最多 3，重启不得重置。jobs.input_json 及 result_json 允许到期清除，保留 payload_purged_at 和不含正文的计费元数据。

## 5. 事件和榜单口径

- `capture_created` 由 API 在采集事务中写入；不接受客户端直接指定事件类型来伪造服务端采集。
- `export_authorized` 在许可事务写入；不是下载完成。
- `download_started` / `download_completed` / `download_failed` 由插件按 Chrome downloads 状态报告；标注 origin=client，不能把它当独立核验的销售证据。
- `actor_key` 由服务端生成：采集事件取当次已验证主体；导出/下载事件取 export_permit 冻结的主体。账号为 `u:<userId>`，匿名为 `i:<installationId>`，客户端不能指定。事件 user_id_at_event 不追溯改写。
- occurred_at 只作诊断，榜单统一使用服务端 received_at，防止客户端回填时间刷历史榜。
- 24 小时、7 天、30 天为截至查询时刻的滚动窗口。分别 COUNT DISTINCT actor_key，并按匿名/账号拆分；一个匿名安装后又登录可能在两类出现，明确不提供“真实人数”合计。
- 默认排名：去重完成导出主体数降序，其次完成导出次数，其次最近完成导出时间；可切换采集榜。多次下载同一个 permit 只计一次完成。
- 首版直接查带索引的 operation_events，后台结果可缓存至应用内存 60 秒；日汇总保留不含身份的每日归档；M6 界面最近 7 天图表直接按原始事件的 UTC 日期分组，避免异步归档尚未赶上时显示过时数据。性能有实测瓶颈再加专用榜单快照，不预先建设数据仓库。
- 热度面板显示时间范围、指标含义、样本量、匿名/登录构成。低样本给“样本不足”，不随意打“爆品”标签。

### M6 教程和任务表（0006_m6_admin）

| 表 | 当前字段 | 约束 |
| --- | --- | --- |
| tutorials | id、title、summary、url、content_locale、category、placement、sort_order、enabled、version、created_at、updated_at | PK(id)；INDEX(enabled,placement,content_locale,sort_order)；服务层最多 100 条，禁用代替删除 |
| data_deletions | id、principal_type、principal_id、state、phase、progress_cursor nullable、created_at、updated_at | PK(id)；INDEX(state,created_at)；principal 为受验证 user/installation，多态引用由服务层控制；在统一短事务内复用已有 pending 请求 |
| product_daily_stats | id、day_utc、product_id、capture_count、export_count、anonymous_capture_actors、account_capture_actors、anonymous_export_actors、account_export_actors、created_at、updated_at | UNIQUE(day_utc,product_id)；product_id RESTRICT FK；不保存 actor_key/用户明细，不能相加推算多日 distinct |

settings.admin_limits 保存 `{allowedTutorialHosts:[]}` 与乐观锁版本；settings.retention 初始 `{payloadDays:30,eventDays:90,aggregateDays:365,auditDays:180}`。清理读取此策略，首版允许运维缩短、拒绝超过已声明上限；后台没有调整保留期入口。0006 不修改已有业务数据、不启用 AI。本地主库此前已至 0007；0008_admin_credentials 新增 admin_credentials，应用后为 24 张业务表＋runad_migrations。

## 6. 保留和清理

初始策略写入配置并在上线隐私说明中体现：

| 数据 | 初始保留规则 |
| --- | --- |
| 验证码 | 明文只在发送期间存在于内存；验证后清除 HMAC，挑战记录过期 24 小时清理 |
| 限速 IP 指纹桶 | 最长 48 小时；使用带密钥 HMAC，不存裸 IP 到业务表 |
| 会话 | 过期/撤销后 30 天清理；日志不存 token |
| 草稿和 AI 输入/结果 | 默认 30 天清除正文 payload，保留无正文元数据至下游引用清理；正在执行的任务不超过有界任务寿命，不能无限延期 |
| 采集、许可、原始事件 | 默认 90 天；个人记录删除同时清理其可识别事件 |
| 商品快照 | 无有效草稿/采集/任务引用且 90 天未见后清理 |
| 每日聚合 | 默认 365 天；不含身份明细，删除主体后重算仍在保留期内的可重算窗口 |
| 管理审计 | 默认 180 天，不记录秘密值 |
| 无正文额度/费用计数、已完成删除请求 | 默认 90 天；个人删除不立即清空当前计费/防滥用额度 |

清理采用小批次任务，按依赖顺序删除，不能一个大事务锁全库。引用未解除前不删除上游记录；任务使用到的 revision 必须至少保留到该任务和许可均到期。数据删除与备份保留的差异在隐私说明中写清楚。

具体顺序：30 天清除过期 draft_revisions、jobs 的正文，将读取返回 RESOURCE_EXPIRED；90 天清理事件/许可后，再删除无引用 job_requests、job_attempts、jobs、revisions、drafts、captures 和快照。许可保存 hash、级别、finding IDs、确认时间供 90 天审计，不复制完整标题/描述/quote；不能因许可外键把所有草稿正文实际保留 90 天。source_products.latest_snapshot_id 要在清理旧快照前更新或置空。源商品快照仍按上表独立保留至 90 天，不把“草稿正文 30 天”宣传为“所有来源数据 30 天删除”。

M6 worker 每 30 秒触发维护周期，每次一个个人删除批次、一个到期清理批次、一个每日归档批次；每批最多 25 行，在已有 access_mode 锁序下使用短事务。进度分别保存在 data_deletions.phase/progress_cursor 和 runtime_heartbeats(retention/daily-rollup)。每日汇总 SQL 在写事务外计算，发布时校验随机 generation，旧计算不能覆盖新进度。

个人删除顺序：取消任务并结算预留 → 事件 → 许可 → requests → attempts → jobs → revisions → drafts → captures → 可重算窗口 daily_stats → 解除本人历史关联。快照在没有其他 capture 引用时才清除并置空 latest_snapshot_id；发生时 user_id 非空的其他账号记录不会因共享安装而被删除。过去 90 天内聚合重算，90 天外的匿名聚合不因缺少原始事件而伪造重算。

到期任务先处理 24 小时执行期限，再清理正文和 90 天依赖；任务过期时仍不能把未确认的供应商费用写成 0。会话、挑战、限速桶分别遵守上表期限；源商品/店铺依据 last_seen_at，仍被 daily_stats 等引用时保留无用户正文的商品元数据。运行间隔和批次意味着到期删除由 worker 逐批完成，积压时须在后台观察维护心跳和任务状态；大规模负载/运维备份验证属于 M7。

## 主题返利配置（0007）

现有 settings 新增 `theme_links` key：value_json 为主题链接数组（id、name、aliases、url、enabled，字段约束以 CONTRACTS 为准），version 乐观版本、updated_by 管理员、created_at/updated_at 沿用现有字段。迁移 0007_theme_links.sql 只补空数组/version=1，不覆盖已有配置。无新表，仍为 23 张业务表＋runad_migrations。

管理员整体保存主题配置，沿用 AuthStore 的事务锁，验证 expectedVersion 后递增版本，同时写 admin_audit_logs，action=`theme_links.save`、target_type=`settings`、target_id=`theme_links`，保存前后配置。无配置时公开查找返回 null；后台首次保存也可受控创建配置。配置仅保存公开返利链接，不保存合作平台密码/API 密钥。删除单条通过版本化完整数组保存实现。

