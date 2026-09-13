# 接口、数据合同和状态机

所有 API 位于 `/api/v1`，JSON UTF-8；成功 `{ data, requestId }`，错误 `{ error: { code, message, retryable, details? }, requestId }`。不要将供应商原始错误或堆栈返回浏览器。

最外层 requestId 仅用于 HTTP 诊断；持久 AI 请求标识统一为 data.aiRequestId，不能混用。输入 riskRequestId 指该持久标识。

本文件是实现合同；各 DTO 在 packages/contracts 中用 Zod 落地。M1 身份端点已落地；商品、AI 等后续端点仍是规格。实现进度见 IMPLEMENTATION_PLAN。

## 0. 语言合同

- `UiLocale = zh-Hans | zh-Hant | en`；本地 `uiLocalePreference = auto | UiLocale`，默认 auto；`resolvedUiLocale` 为运行时解析结果，不代替偏好保存。
- 草稿字段 `language` 专指商品改写输出语言，首版为 `preserve | zh-Hans | zh-Hant | en`，默认 preserve（保持原文语言）。preserve 下保留各字段原有语言，混合语言保留并提示，不按 UI 翻译；只有用户确认改写才改变内容。targetCountry 独立且仍须明确选择。
- 新建 risk-checks/rewrites 请求增加 `reportLocale:UiLocale`，用于模型解释、建议和 changeSummary 的语言；不用于决定标题/描述的输出语言。服务端校验、持久保存，纳入任务 canonical_input_hash，因此不同报告语言不错误命中同一任务。
- reportLocale 不进入 revision.textHash/exportHash，不改变既有风险结果的有效性。切换 UI 不自动重新发任务或翻译已完成结果；已有结果按其 reportLocale 标明语言。
- reportLocale 在创建请求时冻结并返回；轮询、自动重试、网络重发及手动 retry 沿用原值，不因 UI 改变而修改同一 Idempotency-Key 的 payload。只有用户发起全新检查才采用新的说明语言。
- error.code/details 为客户端本地化依据；message 仅为默认诊断回退。日期数字使用 Intl 与 resolvedUiLocale，但 CSV 值和列头使用固定 Shopify 映射。
- GET /config 返回 supportedUiLocales 和 defaultUiLocale=en；只能选择当前构建确实打包支持的语言，不能由服务器广告配置凭空启用未打包词典。
- GET /tutorials 接受 locale；优先返回该语言文章，缺失时回退现有文章并返回 contentLocale。语言参数不能用于拼任意文件路径或执行脚本。
- 教程 title/summary 使用文章实际语言，缺译文不自动翻译。缓存键和 ETag 包含 locale、placement、category、教程内容版本，不能复用其他语言的 304/缓存。

## 1. 鉴权与公共规则

- public：配置、安装初始化、验证码申请/验证、公开教程。
- extension：`Authorization: Bearer <opaque token>`；不得从查询字符串取 token。
- web：HttpOnly cookie；写操作带 CSRF，检查 Origin。
- admin：有效网站会话且 user.role=admin，后台 UI 隐藏不能代替 API 校验。
- 每个核心端点都经过 `authenticate → access_mode → quota/rate → ownership → schema → business`；读取自己已有结果允许匿名恢复，创建 AI、草稿更新、采集和导出许可遵守当前强制登录开关。
- captures、risk-checks、rewrites、AI retry、export-permits 使用 Idempotency-Key UUID，按安装＋操作范围去重；同 key 不同 payload 返回 IDEMPOTENCY_CONFLICT。其他端点按自身合同处理：验证码一次性消费、事件用 clientEventId、PATCH 用 expectedRevision，安装初始化无需先有安装 ID。不能把安装幂等中间件套到网站后台或匿名初始化。
- request body 上限 2 MiB；标题最多 512 字符，描述 HTML 最多 200,000 字符，净化后的可见文本最多 20,000 Unicode 字符；规格首版最多 250、图片最多 250。限制碰到时明确不支持，不能截断成“完整成功”。
- 服务端规范化和计算所有哈希，不信任客户端提供的风险级别、owner、token 用量和 exportHash。
- owner 判断：有 user_id 的草稿只允许该账号；无 user_id 且安装未关联的草稿只允许同一安装的匿名会话；若安装已明确关联账号则要求该账号登录，允许其跨设备访问历史。登录账号 B 不得访问已关联账号 A 的历史。登录时不关联历史则保留旧匿名内容，但登录态不能访问它，须重新采集；UI 预先说明这一点。强制登录开关只阻止核心写操作与新许可，仍允许有效旧匿名会话只读其已有任务状态及草稿，不授予导出权；撤销/过期会话没有此例外。
- AI request 权限通过其关联 revision→draft 按上述规则判断，而非只比较创建时 principal_id。因此同意关联历史的账号可以读取/复用其原匿名检查，但其他账号不能；底层 job 的原始主体和账目不修改。下载报告还必须匹配许可冻结主体，历史读取权不授予改写事件主体的权利。

## 2. 商品合同

### SourceProduct

| 字段 | 类型/要求 |
| --- | --- |
| schemaVersion | 固定 `1` |
| source | { pageUrl, canonicalUrl, storeHost, shopifyProductId, handle, method, capturedAt, selectedVariantId? }；URL 去除无关参数与秘密值；ID 字符串；method=ajax_js/product_json |
| title、descriptionHtml | string；原始采集内容作为快照保留，但原始 HTML 不在面板执行 |
| vendor、productType、tags | 字符串、字符串、字符串数组；未知不推测 |
| currency、marketCountry | ISO 币种代码；国家代码可 null，目标销售国家另选；currencyEvidence 记录 cart_js/verified_source，不能凭符号 $ 猜币种 |
| options | [{ name, position, values: string[] }]；保留实际顺序 |
| variants | [{ sourceVariantId, optionValues, sku?, barcode?, price, compareAtPrice?, imageId?, available?, requiresShipping?, taxable?, weightGrams? }]；金额十进制字符串；未知与 false/0 区分 |
| images | [{ id, url, alt, position }]；http/https 公开图片 URL，禁止 javascript/data/blob |
| completeness | `complete` / `partial` / `uncertain`；附 warnings[] 及 observedVariantCount/expectedVariantCount? |

`complete` 不单由客户端枚举决定；服务端校验规格非空、每个选项数量匹配、规格 ID 无重复、金额和图片引用合法。协议校验通过不等于来源内容真实。未满足完整性只在本地提供诊断，不走正式采集提交。

### PreparedDraftRevision

`draftId, revision, sourceSummary, preparedProduct, descriptionText, exportSettings, targetCountry, language, textHash, exportHash, normalizerVersion, csvMappingVersion, warnings[]`。

- `descriptionText` 是服务端从净化 HTML 提取并解码实体的可见文本，参与 textHash；最多 20,000 个 Unicode 字符，超限拒绝，不截断。
- `preparedProduct` 是服务端完成 HTML 净化和最终 CSV 文本处理后的数据；面板须显示实际将导出的内容，并提示自动净化改动。
- `exportSettings` 首版：status 固定 draft、published 固定 false、handle、preserveSku 布尔、vendor 策略保留或清空。币种不转换。
- `targetCountry` 为单一目标销售国家，首次 AI 前用户明确选择；不能从来源店币种推断法律市场。
- 首次 POST /captures 提交 `draftContext:{targetCountry,language}`；language 默认 preserve，targetCountry 须选择。目标国家未选时只做本地预览，不创建缺少上下文的 revision。
- `textHash` 输入：规范化最终标题、最终 descriptionHtml、从同一 HTML 抽取的可见文本、targetCountry、language、normalizerVersion。固定 key 顺序、UTF-8、NFC、换行 LF，描述中有意义空格不随意折叠。
- `exportHash` 输入：完整 preparedProduct＋exportSettings＋textHash＋CSV 映射版本；数组顺序保留。改价格或图片也更新 exportHash，但不要求重做不受影响的文本检查。
- `csvMappingVersion` 必须是服务端和插件都支持的同一版本，随 preparedRevision 和许可返回；不匹配则要求升级。净化版本升级使旧草稿需重新 prepare，通过 PATCH 当前内容产生新版本并重新检查，不在读取时静默改写旧 payload。
- 序列化和 hash 输入函数共用 product-core；服务端 SHA-256 是权威值，插件生成文件前复算校验。CSV exporter 不得再偷偷修改标题/描述，否则与已检查文本不一致。

M2 已实现限制：单响应上限 2 MiB、采集总超时 12 秒；图片最多 250 张、选项最多 3 个，规格达到 Ajax 250 上限直接判不完整；不分页猜测完整性。product.json 只在自身提供且与当前市场一致的 currency 时接受，普通不带币种的回退会明确拒绝。外部 ID 1–32 位数字字符串、金额最多 14 位整数/6 位小数；标题及短字段最多 512 字符。目标国家当前输入大写两位代码，正式上线前需真实场景验收。

M2 错误：PRODUCT_INCOMPLETE、CURRENCY_UNVERIFIED/CURRENCY_CHANGED、SOURCE_CHANGED、SOURCE_UNAVAILABLE、UNSUPPORTED_PRODUCT、SITE_PERMISSION_REQUIRED、CAPTURE_CANCELLED（含超时）、TEXT_TOO_LONG；服务端版本冲突 REVISION_CONFLICT/幂等冲突 IDEMPOTENCY_CONFLICT 返回 409，清理后的 payload 返回 RESOURCE_EXPIRED/410。每主体核心写请求 30 次/分钟；校验错误走标准错误信封，检查与导出端点仍未开放。

## 3. 接口目录

| 方法/路径 | 权限 | 输入/输出与约束 |
| --- | --- | --- |
| GET /domain-registration | 已登录账号＋限速 | host → {domainCreated, domainExpires, registrar}；服务端查询注册信息，详见域名注册信息章节 |
| GET /config | public | accessMode、configVersion、consentVersion、supportedUiLocales、defaultUiLocale、支持的合同版本、公开限制；教程文字与链接统一由 /tutorials 获取 |
| GET /auth/csrf | web public | 创建/延长 10 分钟 HttpOnly pre-auth cookie，返回绑定网站会话或 pre-auth 的 csrfToken；不返回 cookie 原文 |
| POST /access/check | session 核心 | 空对象输入 → {allowed:true}；仅验证当前身份与登录开关，不采集、不调用 AI、不授予导出许可 |
| POST /installations | public＋限速 | { extensionVersion, consentVersion, consentAccepted:true } → installationId、匿名 token、expiresAt；不接受客户端指定旧 ID |
| POST /sessions/renew | 有效匿名/插件会话 | 延长现有 token 的 expiresAt，返回 {expiresAt}，不返回新 token；重复调用安全，限速且检查安装/账号状态 |
| POST /auth/email/start、/auth/email/verify | 停用 | 保留安全传输校验后返回 REGISTRATION_REVIEW_REQUIRED/403；不发送邮件、不消费挑战、不签发会话 |
| POST /auth/registration | 网站CSRF或插件安装会话＋限速 | 提交申请，不签发账号；详见注册审核 API |
| POST /auth/password/login | 网站CSRF或插件安装会话＋限速 | 审核通过后密码登录；详见注册审核 API |
| GET /admin/members | admin web | 审核申请分页；详见注册审核 API |
| PATCH /admin/members/:id/review | admin web＋CSRF | 通过/拒绝并审计；详见注册审核 API |
| POST /auth/admin/login | web public＋CSRF＋限速 | {login,password} → {user,expiresAt}＋HttpOnly web cookie；只接受 admin_credentials 中的内部管理员账号，密码用 scrypt salt/hash 校验；错误统一 ADMIN_LOGIN_FAILED，不依赖 SMTP，不给插件 Bearer 使用 |
| POST /auth/logout | session | 撤销当前会话；网站清除 cookie 并返回 {credential:null}；插件返回 {credential:{token,installationId,expiresAt}}。已关联安装建立新匿名上下文；未关联安装在同一安装签发新匿名令牌（旧匿名会话若仍有效，不因未关联登录而撤销） |
| GET /me | session | {user:{id,email,role}或null,installationId或null,expiresAt,loginRequired,quota}；M1 quota=null，不能显示为无限或零 |
| POST /captures | extension 核心 | { product:SourceProduct, draftContext:{targetCountry,language} }＋Idempotency-Key → {captureId,preparedRevision}（HTTP 201）；preparedRevision 为首个 PreparedDraftRevision；事务内写快照、capture、draft、revision、事件 |
| GET /drafts/:id | owner | {preparedRevision,aiRequests}；aiRequests 为当前 revision 的 {aiRequestId,state} 列表，用于重开恢复；不可跨用户查询 |
| PATCH /drafts/:id | owner 核心 | { expectedRevision, title?, descriptionHtml?, exportSettings?, targetCountry?, language? } → {preparedRevision}；有变化才增 revision |
| POST /drafts/:id/risk-checks | owner 核心 | { revision, reportLocale }＋Idempotency-Key → 202 data:RiskStatus（含缓存命中或已完成结果）；请求版本须仍为当前版本 |
| POST /drafts/:id/rewrites | owner 核心 | { revision, rewriteTitle, rewriteDescription, language, reportLocale }＋Idempotency-Key → 202 data:RewriteStatus；至少一个开关 true，language 必须等于该 revision.language |
| GET /ai-requests/:id | owner | state、progressStage、result/error、retryAfterMs；按关联草稿权限返回，包括明确同意关联的匿名历史 |
| POST /ai-requests/:id/retry | owner 核心 | 失败、已取消的 request/job 或 blocked_auth 可恢复时使用，须 Idempotency-Key；新 request 引用同输入或新任务；不恢复过时 revision 作为当前成功结果 |
| POST /ai-requests/:id/cancel | owner | 取消当前 request；同主体 job 还有其他有效 request 时不取消底层计算；在途供应商请求可能仍产生费用 |
| POST /drafts/:id/export-permits | owner 核心 | { revision, riskRequestId, acknowledgedFindingIds:[], csvMappingVersion:1 }＋Idempotency-Key → permitId、expiresAt、reportUntil、exportHash、preparedRevision；许可 10 分钟 |
| POST /export-permits/:id/events | owner | { clientEventId, type, downloadErrorCode? }；type 仅 download_started/completed/failed，商品与主体由许可推导 |
| GET /tutorials | public | 按 locale/placement/category 查询已启用教程，返回 contentLocale，支持含语言维度的 ETag |
| GET /admin/overview | admin | 最近 7 天事件、任务/attempt 数量和比例、USD 成本、当日预算占用、心跳、UTC 每日事件；字段见下表 |
| GET /admin/products/trending | admin | window=24h/7d/30d、metric、cursor；返回指标定义、样本、匿名/账号拆分 |
| GET /admin/events、/admin/jobs、/admin/users、/admin/installations、/admin/audits | admin | cursor 为上一页末尾 UUID，按 ID 升序，每页 20；仅返回不含正文/令牌/验证码的字段 |
| GET/PATCH /admin/settings | admin | M1 GET → {accessMode,configVersion,emailConfigured}；PATCH {accessMode,expectedVersion} → {accessMode,configVersion}；仅允许此字段，乐观锁＋审计；审核密码登录无需 SMTP；版本冲突与管理员权限仍强制校验 |
| GET /admin/tutorials；POST /admin/tutorials；PATCH /admin/tutorials/:id | admin | GET 与公开教程相同查询但包含禁用条目；POST 创建，PATCH 必须 expectedVersion；禁用代替直接硬删，记录审计 |
| GET/PATCH /admin/limits | admin | 额度、共享预算、教程域名白名单；expectedVersion 乐观锁，不开启 AI |
| POST /me/delete-data | session | 严格输入 {confirm:true}，202 → {id,state}；按已验证主体创建分批删除请求，相同主体 pending 请求复用；保留账号 |
| GET /me/data-deletion | session | [] 或最近一次 [{id,state:pending/complete}]，不返回他人的请求或内部游标 |

本机运维预览：start-frontend.bat 只在服务就绪后打开 /admin/login，不再调用本地免登录桥或签发临时管理员会话。管理员用 admin:bootstrap 写入的 ADMIN_EMAIL/ADMIN_PASSWORD 登录，仍走标准 web cookie、CSRF、管理员 API 校验和审计。LOCAL_PREVIEW_ENABLED=true 仅保留本地调试保护：禁用 BAT 管理进程中的 DeepSeek 密钥，并在严格回环条件下接受 Chrome 自动分配的开发扩展 ID。

插件首次使用交互：产品目录与本地 CSV 下载不自动创建安装身份，不上传商品到自家服务器，也不要求账号登录。旧产品预览、创建草稿及草稿恢复编辑入口均已移除，历史 lastDraft/draftEdits 不再参与产品页渲染。服务端 captures/drafts 的认证、同意字段及登录开关保留，后续重新开放提交入口时仍须明确告知上传用途。

本地目录消息（非 HTTP）：catalog 接收当前 tabId、page（1–201）、collection handle 和 products/collections 类别，只从当前已授权店铺同源读取。商品每页5条，系列每页50条，响应2 MiB/15秒限额；返回卡片 handle/title/vendor/type/image/price/created/url，金额为十进制字符串，外部商品ID不进入目录模型。collectSelected 只接受1–10个 handle，复用采集器的30秒、币种前后核验、来源页面核验和商品规范化；任一失败阻止本次批量下载。downloadCollectionCsv 支持1–1000个规范商品，全店/系列在插件端分页枚举后分批采集，文件超限不截断。卡片创建日期使用公开 created_at，不视为真实上架日期或销量证明；未读取范围不参与搜索排序。所有消息沿用固定扩展页面来源检查。
M1 传输细节：网站生产 cookie 名为 __Host-runad-session / __Host-runad-preauth，Secure、HttpOnly、SameSite=Lax、Path=/；本地开发使用非 __Host 名称且允许 HTTP。网站写请求校验精确 WEB_ORIGIN 与绑定 cookie 的 CSRF；旧网站会话过期不妨碍重新申请密码登录。插件使用构建时精确 API origin、credentials=omit、禁止重定向，后台只接受本插件 sidepanel.html 发出的固定动作，不接受 URL/令牌参数。正式环境服务器只为 CHROME_EXTENSION_IDS 中的来源返回 CORS；本地 LOCAL_PREVIEW_ENABLED=true、非 production、WEB_ORIGIN 为 http://127.0.0.1:3000、请求地址为该回环地址或 Next.js 内部 localhost:3000，且存在 Host 时必须为 127.0.0.1:3000 时，额外接受合法的 chrome-extension://<32位a-p字符> 来源，无需固定开发 ID；会话/权限校验不变。服务器，不接收网页提交的安装 ID。安装令牌只返回一次，无法凭安装 ID 恢复。

当前注册限速：IP 每小时 5、邮箱每小时 3、全站每小时 100；密码登录 IP 每分钟 20、邮箱每分钟 5；安装 IP 每小时 20、续期每 token 每分钟 10。MySQL 原子桶按实际请求计数，重复申请同样扣次数。未配置可信代理 IP 头时共用保守桶；生产代理必须覆盖该头并禁止直连应用端口。遗留邮件服务方法仅保留内部测试/历史兼容，公网端点已关闭。

网站和插件使用同一审核账号与密码登录业务。网站仅交付 HttpOnly 会话 Cookie，不在 JSON 返回令牌；插件以有效安装 Bearer 登录并返回插件凭据，不依赖网站 Cookie。服务端根据传输身份选择会话类型，不接受客户端指定角色、用户 ID 或 clientKind。

验证码验证成功但响应丢失时重新申请验证码登录；不凭已消费验证码重发旧 token。关联历史和创建账号/会话必须处于同一事务，重复登录到同一账号允许恢复访问，不能再次关联给不同账号。

### M6 教程、额度与统计响应

所有日期为 UTC ISO 字符串，所有金额为十进制字符串，比例为 0–1 或 null。错误信封沿用 `{error:{code,...},requestId}`；未知 code 显示当前语言的通用提示及 requestId。

| 合同 | 字段与约束 |
| --- | --- |
| 教程写入 | title 1–200、summary ≤1000、url ≤2048、contentLocale=zh-Hans/zh-Hant/en、category=getting-started/shopify/advertising、placement=website/extension/both、sortOrder 0–10000、enabled；PATCH 额外 expectedVersion |
| 教程列表 | locale 默认 en、placement 默认 website、可选 category/cursor；`{items:[教程字段＋id＋version],nextCursor,etag}`；语言相符优先，其次 sortOrder、id；无匹配译文保留其他语言并返回 contentLocale；每页 20，最多 100 条后台配置 |
| 教程链接 | 启用条目只允许 HTTPS、精确 allowedTutorialHosts，无凭据、自定义端口和 fragment；子域名须独立允许。禁用条目可以暂存未允许链接，但永不公开 |
| 缓存 | 公开教程 Cache-Control: public,max-age=60；ETag 包含 locale/placement/category、内容和页偏移，If-None-Match 匹配才 304；增改禁用/域名删除使新请求失效，已有 HTTP 缓存最多 60 秒。翻页 cursor 绑定同一内容摘要，变化返回 LIST_CHANGED |
| 额度输入 | expectedVersion、dailyBudget（最多 14 位整数、6 位小数 USD）、riskAnonymous/rewriteAnonymous 1–1000、riskAccount/rewriteAccount 1–10000、allowedTutorialHosts ≤30 个小写域名 |
| 额度读取 | 上述字段＋riskEnabled/rewriteEnabled；PATCH 同一事务修改 ai_risk 共享预算、两种次数限制及 admin_limits 版本并审计，保留 enabled/model/prompt/价格，不调用 AI |
| 热榜 | 输入 window=24h/7d/30d、metric=export/capture、cursor；输出 from/to/metric、items、nextCursor。每项 productId/handle/url、captureCount/exportCount、captureActors/exportActors、anonymousCaptureActors/accountCaptureActors/anonymousExportActors/accountExportActors、sampleInsufficient |
| 热榜翻页 | 每页 20；cursor 固定查询截止时间、窗口和指标，一小时内有效。按对应 distinct、次数、最近事件、productId 排序；低于 5 个对应主体显示样本不足。删除可能改变结果，刷新重新开始；不声称数据库快照隔离 |
| 概览 | users/installations 为当前 active 数量；最近 7 天 captures/downloads/totalJobs/failedJobs/totalAttempts/unknownAttempts/retries/knownCost；failureRate=failedJobs/totalJobs、unknownCostRatio=unknownAttempts/totalAttempts，分母为 0 则 null |
| 成本与心跳 | dailyBudget、reservedCost、unknownCostCount 为当前 UTC 日配置/占用；knownCost 为窗口内已知 attempt 估算费用之和，不包含未知费用，未配置价格或无已知成本时 null；heartbeats 返回 name/lastSeenAt/stale（120 秒）；daily 返回 UTC day/captureCount/exportCount |
| 管理明细 | jobs: id/kind/state/errorCode/attempts/estimatedCost/createdAt；events: id/type/productId/actorKind/receivedAt；users: id/email/role/status/createdAt；installations: id/status/linked/lastSeenAt；audits: id/action/targetType/targetId/createdAt。均有 items/nextCursor，不返回业务正文、secret、会话或审计原始 JSON |

删除请求只能操作当前账号、当前匿名安装及已同意关联的历史。pending 时核心写入、旧许可下载回报和新的历史关联返回 DATA_DELETION_PENDING；读取、登录和删除进度仍可用。worker 分阶段取消任务并清理依赖，完成后解除历史关联；既有账号及会话保留，不是注销账号。删除不清空防重复调用所需的当前额度/费用计数；该无正文计数按 90 天策略清理。已经下载到磁盘的 CSV 不会由服务器删除，插件同时清除本机草稿恢复内容；其他设备打开的页面可能仍有内存副本。

## 4. AI 输入/输出

风险任务从 immutable revision 读取 `title, descriptionText, targetCountry, language, textHash`，再加入已验证并冻结的 request.reportLocale 控制说明语言。HTML 只用于哈希和净化，不让模型执行或渲染。

风险成功结果：

```json
{
  "assessment": "signals_found",
  "severity": "medium",
  "findings": [
    {
      "id": "f1",
      "field": "title",
      "quote": "示例品牌授权表述",
      "category": "authorization_claim",
      "reason": "该表述暗示存在授权，单凭商品文本无法核实。",
      "suggestion": "核实授权依据并复核该表述。"
    }
  ],
  "summary": "发现需复核的文本信号。"
}
```

- assessment：`no_obvious_signals` / `signals_found` / `needs_review`。
- severity：`low` / `medium` / `high` / `unknown`。unknown 与 no_obvious_signals 不可组合。
- 交叉校验：no_obvious_signals 必须 severity=low 且 findings 为空；signals_found 必须至少一个 finding，severity 为 low/medium/high；needs_review 必须 severity=unknown 且 summary 非空。findings ID 必须唯一、禁止使用程序保留的 assessment: 前缀；任何不一致算非法响应。
- finding.category：`brand_reference` / `authorization_claim` / `counterfeit_language` / `protected_name_reference` / `other_text_risk`。
- field：title/description；quote 必须能在相应输入文本中定位，不允许模型捏造命中原文；找不到则结构验证失败或修复一次。
- “未发现明显文本风险信号”必须附范围说明：仅标题和描述，未检查图片、授权文件及商标登记情况。这个固定说明由程序添加，不依赖模型愿意输出。
- result 的 model、checkedAt、textHash、reportLocale、promptVersion、schemaVersion 由服务端添加，禁止相信模型输出的版本和时间。reportLocale 是请求的说明语言，不证明模型一定遵守；错语言在验收中记录、修正 prompt，不偷偷另发翻译任务。
- needs_review 是一次有效但无法判断的检查，须明确用户确认后导出；供应商失败、JSON 无效、超长输入则是 failed，不提供许可。

改写成功结果：`{ title?: string, descriptionHtml?: string, changeSummary: string[], factualWarnings: string[] }`。只允许返回勾选字段。选中字段必须返回，未选字段必须省略，多余字段或缺少选中字段按 AI_INVALID_RESPONSE 处理。服务端使用相同 prepareProduct 规则净化候选，比较选中字段净化后可见文本中的数字集合；差异产生 NUMERIC_FACTS_CHANGED，净化变化产生 CONTENT_SANITIZED。数字相同不证明尺寸单位、材质、兼容性等事实正确，始终展示人工核实提示。

RewriteStatus 沿用 RiskStatus 的任务字段，增加 kind:"rewrite"，result 为 `{output:改写输出,before:{title,descriptionHtml},warnings,model,checkedAt,textHash,reportLocale,promptVersion:"rewrite-v1",schemaVersion:1,scope:"rewrite_suggestion",rewriteTitle,rewriteDescription}`。before 来自服务端冻结的输入，output 是净化后的候选。current 还要求 request 关联的 revision 等于草稿当前 revision；拒绝或取消后 result=null。GET /drafts/:id 的 aiRequests 返回 `{aiRequestId,state,kind}`，两个面板分别恢复各自任务。

用户接受只向已有 PATCH 提交选中的 title/descriptionHtml 和原 expectedRevision；实际文本/导出哈希未变时不新增版本。worker 不写草稿。版本过时返回 REVISION_CONFLICT；有未保存编辑时禁用接受，提交期间禁用编辑，用户须重新生成基于最新版本的建议。接受后文本变化会触发最终文本检查，检查失败保留明确失败状态；拒绝只取消 request，不改变草稿或风险结果。描述对比在禁用脚本、网络的 sandbox iframe 显示净化 HTML。

两个选项默认关闭，切换 UI 不创建任务。说明语言与商品语言分离；网络重试保留原 key 和输入，显式失败重试由服务端恢复原 flags/language/reportLocale。重开面板通过草稿的 rewrite request 恢复，不自动生成建议。

rewrite 请求中的 language 必须与指定 revision.language 相同；改变输出语言先 PATCH，避免 UI 语言、缓存键和模型指令互相不一致。

### M3 实际接口补充

RiskStatus：`aiRequestId,state,progressStage,cacheHit,reportLocale,revision,current,result,error,retryAfterMs,expiresAt`。progressStage 为 queued/provider/retry/complete/blocked；current 由服务端按当前 textHash、模型/prompt/schema 和缓存期限计算，不能用 succeeded 单独判断有效。result 为 `{output:风险输出,model,checkedAt,textHash,reportLocale,promptVersion,schemaVersion,scope:"title_description_only"}`；失败/取消无成功 result。

POST retry 输入空对象，须新 Idempotency-Key；新 request 冻结沿用原 reportLocale。仅 failed/cancelled/blocked_auth 可显式重试，过时 revision 返回 409。同 key 网络重试复用自己的 request；同输入已失败而直接新 start 返回 AI_RETRY_REQUIRED，避免隐式无限重试。POST cancel 输入空对象；只取消当前 request，无其他 active request 时终止 job。在途外呼可能产生费用，迟到响应只可补记原 attempt 账目。

AI 写请求每安装 30 次/分钟、轮询每安装 60 次/分钟（网站只读主体按账号）。QUOTA_EXCEEDED/DAILY_BUDGET_REACHED 的 details.resetAt 为下一 UTC 日零点，面板换算当地时间显示。AI 服务未配置/启用返回 AI_UNAVAILABLE；队列错误另含 AI_TIMEOUT、AI_RATE_LIMITED、AI_INVALID_RESPONSE、AI_ATTEMPTS_EXHAUSTED、TASK_EXPIRED，错误都不能代替成功检查。

## 5. 状态机

### 业务流程

```text
未授权 → 已授权/待识别 → 可采集 → 采集中
  → 不支持/不完整（诊断、重试，禁止导出）
  → 草稿已建立 → 原始文本检查 → 结果展示
       → 不改写：确认风险 → 请求导出许可 → 下载
       → 改写/手动编辑：保存新版本 → 最终文本检查 → 确认风险 → 许可 → 下载
```

原始文本检查由面板在采集成功后发起；原文未改变则复用该检查。允许用户在检查期间编辑，但旧结果不能被标记为当前版本的检查。改写按钮不要求原文风险低；它也不自动替用户确认风险。

### Job 与 Request

- job：`queued → running → succeeded`；可重试错误 `running → retry_wait → running`；终态 `failed/cancelled`；未开始且身份不允许时 `blocked_auth`。
- request：`active/cancelled/blocked_auth`，其对外 state 综合底层 job 状态和当前权限计算。仅同主体缓存可复用，且每次验证 request 权限。
- 同一 job 仅服务同一个匿名安装或账号。blocked_auth 恢复需先符合当前 gate：已登录且有草稿权限时以账号新建 request/job；管理员重新允许匿名时原安装也可显式以匿名主体新建 request/job。旧阻塞任务终止并只释放尚未使用的预留，不迁移计费历史。
- 已完成 job 结果不可作业务修改；prompt 版本变化产生新 key，不能原地改写旧检查历史。保留期届满允许按清理策略清空正文并标记过期，不得再作为有效检查使用。
- risk check 是否有效不使用一个永久布尔字段，而根据当前 revision.textHash、目标国家、版本、有效期及 request 权限动态判断。

### 导出许可判定

事务中按以下顺序验证：

1. 会话有效且符合当前登录模式；草稿归属有效。
2. 请求 revision 等于当前 revision，商品完整且字段校验通过。
3. riskRequest 可被当前主体访问，其结果 succeeded，输入 textHash 与当前相同，模型/prompt/schema 是当前允许版本且未过期。
4. signals_found 必须确认全部 finding IDs；needs_review 必须另含保留确认标识 `assessment:needs_review`；no_obvious_signals 不要求额外勾选。
5. 保存许可及确认时的结果摘要、版本、主体和时间，返回完全相同的 preparedRevision。

插件复核 exportHash 后生成 Blob CSV 并启动下载；许可请求时再次读取服务器登录开关。许可有效期间开关变更无法撤回已经发到本地的内容，界面不作“绝对防绕过”承诺。

Blob 属于 offscreen 文档，service worker 保存 permitId/downloadId/主体/事件 ID 映射并发送下载事件。旧事件必须按许可原主体提交，不因中途登录变成另一个用户的下载；切换身份后若失去报告权限则记为本地未上报，不能伪造成功归属。事件可重试 24 小时，退出清除凭据时不能为了补报继续使用被撤销 token。

所有长期保留的幂等响应也重新检查当前权限和有效期：旧许可过期时相同 key 返回 EXPORT_PERMIT_EXPIRED，提示以新 key 申请；不能因为幂等缓存存在而返回已失效许可。客户端配置和 API 使用协议版本，服务器返回 MIN_CLIENT_VERSION_REQUIRED 时只提示升级，不能继续错误解析新合同。

下载完成事件首次出现才入统计；失败后重试下载可使用仍有效的同一 permit，但完成最多计一次。许可过期且未下载时重新申请，检查仍有效则不重复调用 AI。下载已经开始后收到终态报告允许延迟 24 小时入库，不能因此重新授予导出权。

## 6. 关键错误码

| HTTP | code | 面板行为 |
| --- | --- | --- |
| 422 | INVALID_INPUT / CODE_INVALID | 检查表单；验证码错误、过期或已消费不重发旧令牌 |
| 403 | CSRF_INVALID / ACCOUNT_DISABLED | 刷新页面会话或提示账号禁用 |
| 409 | HISTORY_ALREADY_LINKED / SETTINGS_CONFLICT | 不改变历史归属；后台设置冲突须刷新版本 |
| 413 | BODY_TOO_LARGE | 提示请求超限 |
| 401 | SESSION_EXPIRED | 恢复身份/提示登录，保留本地草稿引用 |
| 403 | LOGIN_REQUIRED | 显示注册登录入口，不能只靠隐藏按钮实现限制 |
| 403/404 | FORBIDDEN/NOT_FOUND | 不泄露别人的草稿是否存在；资源通常统一返回 404 |
| 409 | REVISION_CONFLICT / IDEMPOTENCY_CONFLICT | 提示刷新并保留未提交编辑，不直接重试覆盖 |
| 409/410 | EXPORT_PERMIT_EXPIRED / RESOURCE_EXPIRED | 许可重新申请；正文已清理的草稿重新采集，不显示成暂时网络错误 |
| 426 | MIN_CLIENT_VERSION_REQUIRED | 提示更新插件，不能继续使用不兼容合同 |
| 422 | PRODUCT_INCOMPLETE / UNSUPPORTED_PRODUCT / TEXT_TOO_LONG | 明确原因，不生成残缺 CSV |
| 422 | RISK_CHECK_REQUIRED / RISK_CHECK_STALE / RISK_ACK_REQUIRED | 转到当前风险检查/确认区域 |
| 429 | RATE_LIMITED / QUOTA_EXCEEDED / DAILY_BUDGET_REACHED | 展示服务端 retryAfter 或重置时间，不无限轮询 |
| 502/503 | AI_UNAVAILABLE / AI_INVALID_RESPONSE / EMAIL_UNAVAILABLE | 显示未完成、支持重试；不展示为低风险 |
| 503 | SERVICE_NOT_READY | 保留草稿，恢复后继续 |

队列失败通过任务 error 返回，轮询 HTTP 本身仍可 200。服务端 message 为无敏感信息的英语回退文本；UI 以 code/details 查词典，未知 code 显示本地化通用错误及 requestId，不直接展示未翻译的 message。

## 7. 建议的首发配置初值

- access_mode=anonymous_allowed；风险与改写功能启用，改写勾选默认 false。
- 匿名每安装每天 10 次新风险计算、5 次新改写；登录每账号 50/20 次。只是可调起点，M6 根据成本和试用反馈调整，不作为已承诺套餐。
- 单安装每分钟核心 API 30 次；AI 轮询独立限速，不能占满普通操作额度。
- 风险缓存最长 7 天；许可 10 分钟；草稿 30 天；原始行为 90 天。
- 供应商/全局日费用预算必须在上线前填入；没有价格表或预算配置不能默认无限付费运行。

配额按 UTC 日结算并在界面显示具体重置时间。生产参数保存 settings；密钥、数据库 URL、邮件凭据只存服务器环境。

### M5 下载实现

许可过期返回 EXPORT_PERMIT_EXPIRED，即使重用原幂等 key；映射版本不一致返回 CLIENT_UPGRADE_REQUIRED。下载上报仅允许许可原 installation 及原登录/匿名主体，不因后来关联账号重写历史。重复 permit/type 或同 clientEventId 幂等；完成与失败互斥，乱序终态可被记录，不能从失败改为完成。downloadErrorCode 仅接收规范化 Chrome 代码，当前不持久保存详细错误文本。

后台先落地许可/会话摘要/Blob URL，再调用 downloads；状态映射按 downloadId 或原 Blob URL 恢复。未找到记录显示 unconfirmed，不自动重下。事件保留 24 小时重报资格、本地状态最多两天；不保存额外原始令牌。首次点击立即发送后台消息，关闭侧栏不依赖其后续异步操作。






## 主题返利接口

- `GET /api/v1/theme-link?name=<主题名>`：匿名公开只读接口，name 去首尾空格后 1–250 字符；返回 `{link:null}` 或 `{link:{name,url}}`。CORS 沿用插件来源策略，网站概览无安装令牌也可查询；不返回禁用配置、管理 ID 或全部别名。`Cache-Control: no-store`，无外部服务调用和自动跳转。
- `GET /api/v1/admin/theme-links`：管理员 web 会话，返回 `{expectedVersion,items}`。
- `PATCH /api/v1/admin/theme-links`：管理员 web 会话及 CSRF，提交完整配置 `{expectedVersion,items}`；返回保存后的配置。每条 `{id:uuid,name,aliases:string[],url,enabled}`，最多 100 条，每条最多 20 个别名，名称/别名 1–250 字符。URL 最多 2048 字符，仅 HTTPS，无账户密码、非默认端口和 fragment，保留查询参数。重名/别名冲突、重复 ID 拒绝为 INVALID_INPUT；版本冲突返回 REVISION_CONFLICT 409；保存生成审计记录。
- 匹配：名称/别名 NFKC、去首尾空格、连续空白合并、转小写后精确相等。不模糊匹配或自动推断定制主题；不同主题不能配置同一匹配名称。
- 插件用独立三秒查询，失败不阻塞概览、不改变网站缓存时间。仅当前匹配结果可变为 HTTPS 外链，附推广标识及 rel=sponsored noopener noreferrer；语言切换不重查主题。


### 域名注册信息

- `GET /api/v1/domain-registration?host=example.com`：有效账号会话；匿名安装令牌不算登录。无会话、过期、撤销或停用账号返回 SESSION_EXPIRED/401，匿名会话返回 LOGIN_REQUIRED/403。沿用 Origin 和会话类型校验，鉴权先于域名缓存读取。每账号及来源 IP 每分钟各 30 次；未配置可信代理 IP 头时共用限速桶。
- 请求仅含当前 hostname，最长 253 字符，ASCII/Punycode 域名；小写规范化、移除前缀 www。拒绝 IP、完整 URL、端口、路径及用户信息。不猜测多级公共后缀、不将 myshopify.com 的注册日期冒充店铺成立日期；不可查询的子域名显示未识别。
- 返回标准信封，data 为 `{domainCreated, domainExpires, registrar}`。日期为 ISO 时间或空字符串，注册商最多 250 字符；不可用字段为空，前端显示未识别。域名年龄按注册日期计算天数，不代表店铺开业时间。
- 服务端从 IANA RDAP bootstrap 获取对应 TLD 的 HTTPS 注册局端点，不请求用户提交的网站，不跟随跳转；每次外部请求最多 4 秒、响应最多 1 MiB。IANA 目录缓存 24 小时。
- 服务端进程内缓存最多 1000 个域名：成功 7 天，失败/空结果 5 分钟；同域名并发合并，最多 8 个域名并行。重启丢失缓存，不新增数据库表或迁移，不保证多进程共享缓存。
- 插件只请求自身 API origin，不申请 rdap.org/IANA/注册局的 host permission；只发送域名及自家 API Bearer 会话，不发送商品内容或完整网页 URL；令牌由扩展后台附加，不返回页面，不转发给注册局。普通网站概览仍按北京时间自然日缓存；域名注册信息独立查询且不持久缓存到插件，每次展示由服务端验证账号后复用服务端缓存。未登录显示可点击的登录入口，账号变更立即清除显示并重新校验；手动刷新复用服务端有效域名缓存。域名查询失败不阻断其他概览数据。


### 注册审核 API

| API | 权限 | 输入与结果 |
| --- | --- | --- |
| POST /auth/registration | 网站 Origin＋CSRF；插件有效安装 Bearer；限速 | {email,password,confirmPassword,purpose?,consentAccepted:true} → 202 {submitted:true}；不返回用户或令牌 |
| POST /auth/password/login | 网站 Origin＋CSRF 或插件安装 Bearer；限速 | {email,password} → 网站 {user,expiresAt}＋HttpOnly Cookie；插件 {token,installationId,expiresAt,user} |
| GET /admin/members | 管理员 web 会话 | state=pending/approved/rejected 默认 pending，cursor 可选 UUID → {items,nextCursor}，每页 50 |
| PATCH /admin/members/:id/review | 管理员 web 会话＋CSRF | {decision:approved/rejected,note?:string} → {state}；仅 pending 可转移，已处理返回 REVISION_CONFLICT/409 |

- 请求严格 schema。email 去首尾空格、小写、合法邮箱格式且最长 254；密码原样 8–256 字符、两次完全一致；用途去首尾空格后 5–500 字符，备注最长 500。登录密码 1–256；公开请求不能传 userId、role、state。错误 INVALID_INPUT，不返回密码或字段原值。
- 注册遇到已有 users/member_accounts 邮箱统一返回 submitted，不修改账号或原密码。pending 不创建 users、无会话；批准时原子创建 active 普通用户、绑定账号、写 reviewerId/时间及 member.review 审计。批准碰到已有用户邮箱返回 MEMBER_ACCOUNT_EXISTS/409，绝不按未验证邮箱自动绑定既有账号。
- 注册用途 purpose 可省略，未填写保存为空字符串；提供时仍校验 5–500 字符。网站环境变量 REGISTRATION_PURPOSE_ENABLED=true 可恢复用途输入，默认隐藏。注册页不显示审核引导和未验证说明，后台 pending/人工审核及登录限制不变，不发送验证邮件。
- 列表仅 {id,email,purpose,state,createdAt,reviewedAt,note,emailVerified:false}，不含密码材料。备注为管理员内部信息。UUID 游标按 id 排序，不保证申请时间顺序；刷新返回第一页。
- 密码错误/不存在返回 MEMBER_LOGIN_FAILED/401；只有密码正确才显示 REGISTRATION_PENDING/403 或 REGISTRATION_REJECTED/403。停用/失效用户不得登录；审核通过仍须用户主动登录。本版无审核通知、自助重提或密码找回。
- 密码加盐 scrypt，与内部管理员相同版本；昂贵哈希在身份锁外计算，签发会话事务重新核验密码材料和状态，防止并发变更。插件登录撤销携带的旧会话，不自动关联匿名历史。原有管理员使用独立 /auth/admin/login。
- 启用需要显式迁移 0009_member_review.sql；无 SMTP/Google/第三方认证依赖。

### 插件发起的网站注册 / 登录窗口

- 入口发送内部 openRegistration，后台打开自家 /extension-auth?extension=<id>&flow=<随机nonce>&lang=<UiLocale>，500×720 独立窗口。先创建空白窗口并保存绑定，再导航；重复打开复用未过期窗口。不替换原店铺页。
- 窗口分申请注册与密码登录。提交申请需邮箱、密码两次、用途和隐私同意；提交完成只显示待审核。合法登录后才返回原页并刷新域名信息。Google 和邮箱验证码均不显示。
- 外部消息严格限定 registrationStatus({flow})、registrationSubmit({flow,input:memberRegistrationInput})、registrationLogin({flow,consentAccepted:true,input:memberLoginInput})、registrationFinish({flow})；状态与完成没有任意 API 转发能力。
- manifest externally_connectable 仅构建时自家 API origin；后台额外要求精确 /extension-auth 路径、顶层 frame、预绑定 tabId 和 30 分钟随机 nonce。输入验证通过后才初始化缺失的安装身份；既有身份复用。
- 网站发送密码给扩展后台，由后台仅传给自家 API；网页不接收插件 Bearer。sessionStorage 仅保留邮箱和用途，密码只在表单内存中、提交申请/登录成功时清空，不进入日志。chrome.storage.session 保存窗口绑定，完成后清理。
- 完成前再次验证有效账号，关窗并聚焦原 tab/window；原标签已关闭则不重建。窗口直接访问而缺少有效插件流程时提示从插件打开。网站独立 /account 使用 Cookie/CSRF，不调用插件桥接。