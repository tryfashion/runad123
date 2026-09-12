# M1 实现与验收记录

状态：本地代码交付完成；真实 MySQL 连接与首次迁移已通过，事务/并发、SMTP 和插件完整联网登录待验证。未进入 M2，不宣称生产就绪。

后续真实迁移：用户授权执行 db:migrate，返回 MIGRATIONS_APPLIED（退出码 0）。核对 runad123 已有 7 张业务表及 runad_migrations，0000_m1_identity.sql 状态 applied，access_mode 初值 anonymous_allowed、版本 1。此证据仅覆盖首次迁移与结果读取，不代表并发、重跑和邮件验收已完成。

后续真实连接检查：用户已配置 .env，mysql2 成功连接本地 runad123，版本 8.0.46，启用 STRICT_TRANS_TABLES，数据库当前为空（0 张表）。仅执行连接与元数据读取，未建表、未执行集成测试。直接连接的 session time_zone 为 SYSTEM；项目连接工厂另设置 UTC，仍需在实际迁移/服务验证中确认。

## 本轮实现

- 7 张身份、配置和审计表，Drizzle schema 与显式 SQL 迁移；默认 anonymous_allowed。迁移前检查 MySQL 8.0.16+、STRICT 模式；迁移日志与校验和、互斥锁、失败中断。无自动建库、无自动 push。
- 只通过运维命令初始化首个管理员；邮箱登录仍需验证码，公开注册不能指定角色。
- 匿名安装同意记录、32 字节随机令牌、数据库 SHA-256 摘要；匿名 90 天、插件登录 30 天、网站 7 天；有效期续期不更换令牌，过期/撤销/禁用不能复活。
- 邮箱验证码规范化、HMAC、10 分钟到期、5 次错误上限、60 秒重发间隔；pending/sent/failed 状态；正确消费后清除 HMAC。安装与网页 pre-auth 绑定、消费/账号创建/关联/签发同一事务。
- 仅用户明确同意才关联历史；撤销关联安装的匿名会话，退出建立新匿名上下文；不同意则登录账号不能访问旧匿名草稿。M2/M3 将使用共用 owns 权限规则，当前没有伪造商品/AI 表来冒充历史接口完成。
- 网站 HttpOnly Cookie、Origin/CSRF；插件 Bearer、精确 API host permission、trusted-context 存储、固定消息类型与 sidepanel 来源校验。面板响应不包含令牌。
- 服务端访问开关与 admin 身份校验、版本冲突、最小审计。SMTP 连接检查不通过或使用 memory 适配器时，不能在后台打开强制登录。
- 网站 /account、/admin 和插件账号区；简/繁/英提示、验证码倒计时，切换 UI 语言不重发邮件。真实 API 无配置返回 503，不显示登录成功。
- 新增 Nodemailer 10.0.8、类型包 8.0.1，精确锁定；其 engine 要求支持现有 Node 24，未更换框架。

## 本地验证证据

所有 pnpm 命令均通过 `npx --yes pnpm@9.15.4` 调用。

| 命令/验证 | 结果与边界 |
| --- | --- |
| install --frozen-lockfile | 通过，新增依赖已锁定 |
| run build | 全 workspace 构建通过；Next 包含 /account、/admin 和 /api/v1/[...path] |
| run typecheck | 工作区及工具/测试类型检查通过 |
| run lint | 格式检查与浏览器依赖边界检查通过 |
| run test | 5 个文件、45 项通过；新增 23 项身份/传输验证采用内存事务模型，非真实 MySQL |
| run test:e2e | 5 项通过；真实测试 Chromium 和打包插件，网站登录使用真实服务逻辑＋模拟数据库/邮件，经浏览器 Cookie/CSRF 流程；未配置 API 验证使用实际 Next API |
| 插件浏览器验证 | 加载 service worker/侧栏、与未配置 API 通信显示错误、语言重启记忆、未同意按钮禁用；不是插件真实收码登录全链路验证 |
| 图片检查 | 手机登录/后台页、插件侧栏已目视检查；修正窄屏标题溢出、按钮样式以及直接打开侧栏页时的消息识别 |
| 迁移入口缺配置 | node --env-file-if-exists=.env packages/db/dist/migrate.js 返回 1 / MYSQL_URL_REQUIRED，未修改数据库 |
| run test:mysql | 初轮缺配置未运行；2026-09-12 补充：独立本地 MySQL 8.0.46/runad123_test 已通过迁移重跑、摘要往返、并发验证码/限速、回滚；邮件仍模拟 |

测试覆盖：错误次数持久化、超时/过期、并发重复消费、错安装和错 pre-auth、响应丢失后重新验证、关联与不关联、跨设备历史权限、另一账号不可抢占、匿名开关限制、禁用账号/安装、管理员鉴权、SMTP 未就绪、配置版本冲突、Cookie 不进入 JSON、CSRF/来源校验、原子限速和错误脱敏。

首轮浏览器测试的登录业务已通过，窄屏溢出断言失败后修复并重跑通过；沙箱内测试结束清理进程曾挂起，核对本轮进程后清理，使用允许测试进程清理的运行权限后正常完成。未操作日常 Chrome。账号浏览器测试关闭 trace，避免将验证码与会话写进追踪文件；截图在退出后生成。

## 接入真实服务

1. 先准备已有 MySQL 8.0.16+ 数据库及专用账号，在根 .env 填 MYSQL_URL、AUTH_SECRET（至少 32 随机字节）、WEB_ORIGIN。没有数据库不运行迁移。生产要求 HTTPS。
2. 执行 db:migrate；第一次创建表与种子，再次执行应跳过已应用文件。出现 applying 遗留或 checksum 不一致必须检查实际数据库状态，不能删日志后盲目重跑。DDL 不可完整事务回滚。
3. 加载 apps/extension/dist 后，将 Chrome 展示的插件 ID 写到 CHROME_EXTENSION_IDS，重启 web；开发 API 默认 http://127.0.0.1:3000，改地址需设置 RUNAD_API_ORIGIN 并重建插件。生产构建拒绝默认本地 origin。
4. 设置 MAIL_MODE=smtp 及 SMTP_HOST/PORT/USER/PASSWORD/FROM；要求 TLS，连接与发送有 10 秒总超时、禁用正文/协议日志。SMTP verify 只证明连接鉴权，不证明 inbox 投递。
5. 在 .env 临时填写 ADMIN_EMAIL 后执行 admin:bootstrap；管理员在 /account 真实收码登录，访问 /admin 测试开关和普通账号拒绝路径。不要通过公开注册或请求参数赋予管理员角色。
6. 部署时可信代理覆盖 TRUSTED_CLIENT_IP_HEADER 指定的头，并禁止直接访问应用端口。未设置时所有请求使用保守公共 IP 桶，不能用于正常规模上线。

## 仍需真实验收

- MySQL 8.0.46、UTC 会话、STRICT 模式、迁移首次/重跑、摘要往返、事务回滚、并发消费与限速已通过。迁移中断恢复演练、逐项数据库约束故障注入、生产权限与统一锁压力测试仍待验证。
- 已提供 test:mysql 脚本，需单独 .env.test 的 MYSQL_TEST_URL；数据库名只接受 runad123_test 或 runad123_test_后缀。它会留下测试记录供检查，不自动清空/删除数据库。该脚本的 SMTP 仍为模拟，不能同时宣称邮件通过。
- 真实 SMTP 收件、三语言内容、错误配置和超时；管理员真实收码后切换开关，插件匿名→登录→关联→退出→新匿名身份的联网全流程。
- Chrome 原生工具栏打开面板、最低 Chrome 120 兼容；目前自动化版本沿用 M0 测试 Chromium。
- 身份数据定时清理按 DATABASE 保留策略在上线前完成；当前只在验证码消费时清除 HMAC，没有声称已部署周期清理。网站 ready 继续返回 503，M3 才有真实任务 worker 健康闭环。
- M0 的真实 Shopify 接口/导入仍待验证；M2 采集、M3 DeepSeek、M4 改写、M5 正式导出未实现。

## 实现依据

- [Nodemailer SMTP](https://nodemailer.com/smtp)：SMTP/TLS、超时、verify 和禁用调试输出。
- [Drizzle 自定义类型](https://orm.drizzle.team/docs/custom-types)：BINARY(32) 以 Buffer 映射，避免摘要字符串编码问题。
