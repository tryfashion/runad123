# M4 验证与改写接入

日期：2026-09-12。结论：M4 本地实现与自动化验收完成；真实 DeepSeek 改写效果及其他外部集成仍待验证。下一编码阶段 M5，本轮没有实现正式 CSV 下载。

## 实现与边界

- 标题、描述独立勾选，默认关闭。服务端拒绝两个都未选、语言不等于 revision.language、模型漏掉选中字段或返回未选字段的请求/响应。
- 两类 AI 共用持久队列、租约、attempt、重试和费用结算，按 kind 选择 prompt、配置及输出 schema。缓存包含选项、商品语言、说明语言、输入、模型和版本，计算次数分别限额，全局 USD 日预算共用。
- 结果先按草稿规则净化和规范化，再显示原文与建议。描述在禁止网络和脚本的 sandbox iframe 中预览。选中字段的可见数字集合发生变化会提示 NUMERIC_FACTS_CHANGED；始终提示人工核实其他事实。
- 生成、失败、拒绝不修改草稿。接受只 PATCH 选中的字段，使用生成时的 expectedRevision；版本冲突返回 409，有未保存编辑时禁止接受，接受提交期间禁止修改字段。
- 接受后实际文本变化创建新版本并触发检查；未变化不创建新版本，可复用有效检查。改写不是风险检查，也不是无侵权证明。
- 面板支持轮询、取消/重试、恢复任务、说明语言冻结；切换 UI 不产生新计算。网络响应丢失保留请求 key 和原输入；显式重试由服务端恢复原选项和语言。
- 新增 0004_m4_rewrite 和 ai:configure:rewrite；没有增加数据库、外部中间件或竞品功能。

字段、API 和状态的现行定义在 CONTRACTS.md；配置、费用键及事务规则在 DATABASE.md。本文件只记录证据和接入步骤。

## 自动化证据

命令使用项目固定的 `npx --yes pnpm@9.15.4`。

| 验证 | 结果 | 覆盖及限制 |
| --- | --- | --- |
| run test | 91 项通过 | 新增 11 项改写用例；选项、语言约束、严格输出、净化、数字提示、显式接受/拒绝、不变文本、并发版本冲突、重试冻结、费用与次数隔离、权限和 HTTP 路由。AI/邮件为模拟适配器 |
| run test:mysql | 通过 | 真实 MySQL 隔离库迁移及幂等重跑、并发去重、SKIP LOCKED/租约恢复、改写持久结果、费用结算、显式接受及旧版本拒绝。AI/SMTP 模拟；不是供应商集成测试 |
| run test:e2e | 9 项通过 | 独立 Chromium 加载真实构建的插件，模拟 API；验证默认关闭、UI 切换不创建任务、重开恢复、未保存编辑禁止接受、拒绝不保存、接受只 PATCH 标题、产生最终文本检查。既有 8 项回归通过 |
| run build | 通过 | Next 网站/API、worker、插件和共享包；最终 UI 调整后另执行 extension build 通过 |
| run typecheck | 通过 | 全部 workspace 和 scripts/tests 类型检查 |
| run lint | 通过 | Prettier 与仓库边界检查 |
| run db:migrate | 通过 | 本地主库应用 0004；没有建新库或删除数据 |

浏览器截图：`artifacts/m4-rewrite-panel.png`。已目视检查 400px 侧栏，无横向溢出，原文、建议、数字警示和确认操作可见。截图中的商品和模型结果是测试夹具，账号面板未接真实服务。

首轮测试发现一处测试断言大小写不匹配并已修正；既有 worker 启停测试的外层 5 秒限制早于子进程的 10 秒期限，在首次运行时超时。外层改为 15 秒，仍保留子进程 10 秒硬超时及启停事件断言；最终全部通过。Windows Next 继续使用 M0 记录的官方 WASM SWC/webpack，原生 SWC 缺失提示仍存在，未更换依赖或技术路线。

## 本地数据库与启用方式

主 `runad123` 和隔离 `runad123_test` 已应用 0000–0004，仍是 19 张业务表加迁移表。主库读取确认 ai_risk.enabled=false、ai_rewrite.enabled=false、rewrite prompt 为 rewrite-v1；没有运行 AI 开启命令或向供应商发送付费请求。

从旧 M3 环境升级时先停止 API/worker，再执行迁移并启动新代码。0004 将 global/risk_check 计费键改为 global/ai，旧 worker 不应与新 worker 混跑；迁移只改键，保留原有费用及次数。

实际接入需要在本地 `.env` 配置 AUTH_SECRET、CHROME_EXTENSION_IDS、DEEPSEEK_API_KEY，以及经供应商核实的 AI_MODEL、价格、上下文和预算。此轮这些外部配置仍缺失，只检查是否存在，没有输出真实值。

配置顺序：

```powershell
npx --yes pnpm@9.15.4 run db:migrate
npx --yes pnpm@9.15.4 run ai:configure
npx --yes pnpm@9.15.4 run ai:configure:rewrite
```

两个 configure 命令只写非敏感设置；启用并启动 worker 后已有排队任务可能产生费用。改写沿用 AI_MODEL、AI_PRICING_VERSION、AI_INPUT_PER_MILLION、AI_OUTPUT_PER_MILLION、AI_INPUT_TOKEN_BUDGET、AI_CONTEXT_TOKENS；输出上限读取 AI_REWRITE_OUTPUT_TOKENS（默认 8192，须按供应商实际限制核验）。改写次数初值为匿名 5/账号 20 次每天。实际全局预算统一读取 settings.ai_risk.dailyBudget；修改预算使用风险配置流程，不能通过单独改写配置再获得一份预算。

## 仍待真实验证

1. 真实 DeepSeek 模型可用性、JSON 结构、token/费用、超时和错误语义；目前只有模拟传输与数据库账目测试。
2. 原文、中英混合语言、标题/描述单选及双选的真实改写质量；人工对比数量、尺寸单位、材质、兼容性等。数字集合相同仍可能改错事实，不提供自动事实认证。
3. M3 的 30 条候选风险样本仍无人工金标和真实输出；结构通过率不代表风险识别准确率。
4. 真实 Shopify 当前商品采集、正式 CSV 导入、真实 SMTP 收件、日常 Chrome 原生操作、实际进程强杀恢复及发布配置。M3 的租约过期/模拟中断测试不能替代全部实际故障演练。

本地验收完成不代表可生产上线；以上缺口保持打开。
