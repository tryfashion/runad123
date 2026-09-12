# runad123

面向 FB、Google、TikTok 投放人员的 Shopify 商品采集、文本风险检查和上架准备工具。

**当前阶段：M0–M6 本地实现完成。113 项单元、12 项浏览器用例及真实 MySQL 集成通过；真实 DeepSeek、Shopify 采集/导入、SMTP 与生产运维仍待验证。M7 尚未开始，不能作为生产系统上线。**

第一版闭环：打开 Shopify 商品页 → 采集当前商品 → 服务端 DeepSeek 检查标题和描述 → 按需 AI 改写或手动编辑 → 检查最终文本 → 导出 Shopify CSV → 查看导入教程。服务端同时记录有明确告知的采集和导出行为，供内部分析商品关注热度。

## 文档入口

1. [架构与产品边界](docs/ARCHITECTURE.md)：技术选型、目录、数据流、安全边界、部署。
2. [数据库规格](docs/DATABASE.md)：表、索引、归属、统计口径、保留周期。
3. [接口与状态机](docs/CONTRACTS.md)：字段、鉴权、AI、导出、错误处理。
4. [实施与验收](docs/IMPLEMENTATION_PLAN.md)：按阶段施工，避免一次性生成整个系统。
5. [代理工作约定](AGENTS.md)：后续写代码模型必须遵守的范围和实现规则。
6. [第二轮复查](docs/REVIEW.md)：已修正的问题、实测待办与首版限制。
7. [M0 工具链与验证记录](docs/M0_VALIDATION.md)：锁定版本、运行结果与实际限制。
8. [M1 验证与接入说明](docs/M1_VALIDATION.md)：身份服务、真实验证缺口和数据库初始化。
9. [M2 验证记录](docs/M2_VALIDATION.md)：采集、草稿、实际数据库验证与外部缺口。
10. [M3 验证与 AI 接入](docs/M3_VALIDATION.md)：持久任务、额度、DeepSeek 配置和验证缺口。
11. [M4 验证与改写接入](docs/M4_VALIDATION.md)：单字段改写、对比确认、共享预算和真实验证缺口。
12. [M5 验证记录](docs/M5_VALIDATION.md)：CSV、许可、真实浏览器下载和导入验证缺口。
13. [M6 验证与使用](docs/M6_VALIDATION.md)：教程、统计后台、删除/保留策略、真实 MySQL 证据与剩余接入项。

## Windows 本地运行

使用 Node 24（本机已验证 24.13.0）。在项目根目录打开 PowerShell，安装锁定依赖：

```powershell
npx --yes pnpm@9.15.4 install --frozen-lockfile
```

三个进程分别用独立终端运行，按 Ctrl+C 停止：

```powershell
npx --yes pnpm@9.15.4 run dev:web
npx --yes pnpm@9.15.4 run dev:extension
npx --yes pnpm@9.15.4 run dev:worker
```

网站为 `http://127.0.0.1:3000`。三个 dev 命令会先构建共享包；开发时修改 packages 后重启对应命令。worker 在 MYSQL_URL、AUTH_SECRET 齐全时执行分批维护；额外提供 DEEPSEEK_API_KEY 且开启服务端 AI 配置后处理风险检查和改写。配置缺失保持对应功能不处理，不伪装检查成功。

插件：打开 Chrome 扩展管理页，启用“开发者模式”→“加载已解压的扩展程序”→选择本项目 `apps/extension/dist`，然后固定并点击 runad123 工具栏图标。插件代码改变后，在扩展管理页点刷新并重新打开侧栏。M2 使用 sidePanel/storage/activeTab/scripting 和精确 API host permission；首次采集时按当前站点申请可选权限，已授权站点识别 Shopify 后显示 S 标记。M5 已加入 downloads/offscreen/alarms 权限用于后台下载与状态恢复。不要把开发预览包提交商店。

只查看界面时不用创建 `.env`。运行真实身份服务需要复制根目录 `.env.example` 为 `.env`，填写已有 MySQL 数据库连接、AUTH_SECRET、WEB_ORIGIN 和 CHROME_EXTENSION_IDS，并执行显式迁移；真实密码不进 Git。SMTP 未配置时匿名身份可以使用，邮箱登录明确不可用。开发环境与正式环境的 API origin/插件 ID 分开管理，当前无生产凭据、无固定生产插件 ID。

## 验证命令

```powershell
npx --yes pnpm@9.15.4 run build
npx --yes pnpm@9.15.4 run typecheck
npx --yes pnpm@9.15.4 run lint
npx --yes pnpm@9.15.4 run test
npx --yes pnpm@9.15.4 run test:browser-install
npx --yes pnpm@9.15.4 run test:e2e
npx --yes pnpm@9.15.4 run probe:csv
```

浏览器测试需要先 build，且 3000 端口空闲；测试只使用独立临时配置目录，不接管用户的 Chrome。浏览器安装缓存位于 `.cache/ms-playwright`。测试进程仅对回环地址设置 NO_PROXY，并给测试浏览器禁用代理，不修改系统代理。截图和合成 CSV 位于 `artifacts`，忽略提交。

`db:migrate` 已实现；未配置 MYSQL_URL 时返回非零且不修改数据库。有配置时只在现有数据库执行受控 SQL 迁移，不自动建库。`/health/live` 返回 200，`/health/ready` 返回 503，避免把未接入的数据库/worker 宣称为生产就绪。

Windows 当前固定使用 Next 官方 WASM SWC＋webpack：16.3.5 的 Windows x64 原生包元数据存在但下载地址返回 404，已通过显式 WASM 依赖锁定替代，避免首次构建依赖全局缓存。不是更换框架。依赖详情见 M0 验证记录。

规格职责：ARCHITECTURE 定义范围和模块边界；CONTRACTS 是接口、权限及状态行为的唯一详细定义；DATABASE 是持久字段与事务规则的唯一详细定义；IMPLEMENTATION_PLAN 只定义施工和验收；REVIEW 记录复查历史，不覆盖现行规格。更新一个规则时同步受影响文档，不能只往末尾追加另一套定义。

## 已确定的约束

- Chrome Manifest V3 插件；数据库只使用 MySQL 8。
- 界面默认跟随浏览器语言，可手动切换并记忆；首版简体中文、繁体中文、英语，与商品输出语言分开。
- 初期允许匿名使用；服务端可以切换为必须注册登录。匿名安装身份不等于真实用户身份。
- 标题和描述的 DeepSeek 文本风险检查是第一版必做项，在服务端执行，必须联网。
- AI 标题改写、描述改写为两个独立选项，默认关闭，生成结果须由用户确认。
- 第一版支持当前商品及其可完整获取的规格、图片；不把集合、整店导出塞进首版。
- 导出前检查最终文本；改写不能使商品自动获得“无侵权”保证。
- 网站承担账号、教程、内部统计和配置；不做广告库，也不估算竞争店铺销量。
- 所有竞品结论仅用于需求参考，自主实现，不复制其代码、图标或规则库。

## 给下一轮编码的任务

> 请先读 AGENTS.md、README.md 和 docs/IMPLEMENTATION_PLAN.md，再按需读其引用的规格。从实施计划标记的当前进度继续（M6 本地实现完成，真实集成缺口见 M6_VALIDATION；后续为 M7，需用户启动），每次只完成一个阶段及其验收；将真实进度、命令结果、未解决问题更新到 docs/IMPLEMENTATION_PLAN.md。不要重新设计已确定的架构，不扩展第一版范围。涉及文档未定的普通实现细节自行选择并记录。没有外部凭据时完成适配器和可重复的模拟验证，但不能把模拟结果标成真实集成通过。

依赖具体版本已在 M0 核验并锁定，不能直接安装所有包的 latest。生产域名、MySQL 连接、DeepSeek 凭据和邮件服务配置在实际接入时提供，不需要现在提交。

## M1 接入与页面

网站 `/account` 为邮箱登录和个人数据删除，`/admin` 为管理员开关、额度、教程和内部统计。普通账号无法读取或修改后台设置。没有数据库时页面仍可打开，身份 API 返回 SERVICE_NOT_READY。

在 `.env` 填好现有 MySQL 8.0.16+ 连接等配置后运行：

```powershell
npx --yes pnpm@9.15.4 run db:migrate
npx --yes pnpm@9.15.4 run admin:bootstrap
```

第二个命令还需要在 `.env` 填 ADMIN_EMAIL，只允许初始化首个管理员；无密码后门，之后仍通过邮箱验证码登录。MAIL_MODE=smtp 时需要 SMTP_HOST/PORT/USER/PASSWORD/FROM；默认 disabled。memory 仅用于自动化开发测试，不写验证码日志、不提供公开收件箱，不能打开强制登录开关。

数据库集成测试使用单独 `.env.test` 的 MYSQL_TEST_URL，数据库名限定 `runad123_test` 或 `runad123_test_小写字母数字后缀`。测试会在该库迁移并留下测试记录，不自动删除数据库：

```powershell
npx --yes pnpm@9.15.4 run test:mysql
```

本地已配置独立 runad123_test，真实 MySQL 迁移、事务、并发和商品草稿测试已通过；邮件仍使用模拟适配器。生产部署的代理头、邮件真实收件、数据库权限和清理任务仍需按 M1 验证记录及后续里程碑完成。

## M3 AI 接入

迁移后 settings.ai_risk 默认关闭。填好 .env 的 DEEPSEEK_API_KEY、AUTH_SECRET，以及从供应商核实的 AI_MODEL、AI_PRICING_VERSION、AI_INPUT_PER_MILLION、AI_OUTPUT_PER_MILLION、AI_DAILY_BUDGET 和上下文上限，再运行 `npx --yes pnpm@9.15.4 run ai:configure`。该命令只写入非敏感设置，不调用供应商；开启并运行 worker 后排队任务可能产生费用。未运行配置命令不会默认无限付费。

实际模型/价格/上下文需按账户核验，项目不预填猜测型号和价格。价格单位为 USD/百万 token，日预算为 USD；匿名默认每天 10 次，账号 50 次，按 UTC 日结算。详细流程与真实验证项见 M3_VALIDATION。

## M4 改写接入

0004_m4_rewrite 已应用到本地主库及隔离测试库。插件中的标题/描述改写默认不勾选，只有主动生成才排队；支持原文对比、拒绝、接受、数字变更提示和过时版本保护。接受后文本变化会重新检查，未变化的文本可复用有效检查。切换界面语言不翻译商品或另建 AI 任务。

settings.ai_rewrite 默认关闭。配置前核验供应商模型、上下文和输出 token 上限；先按 M3 接入说明配置风险服务与全局预算，然后运行 `npx --yes pnpm@9.15.4 run ai:configure:rewrite`。改写沿用 AI_MODEL/价格配置，输出上限使用 AI_REWRITE_OUTPUT_TOKENS；该命令只写配置，启动 worker 后实际排队任务可能产生费用。本轮没有执行任何 AI 开启命令。

风险和改写的计算次数分别限额，但共用 settings.ai_risk.dailyBudget 的 USD 日预算，不能分别得到一份预算。升级旧 M3 环境时先停止 API/worker，再迁移并用新代码重启。详情见 M4_VALIDATION。


## M6 页面与维护

- `/guide` 使用流程；`/tutorials` 教程列表；`/privacy` 当前数据处理说明。插件中可以打开教程文章或访问上述网站页面，界面语言不改变商品文本。
- 管理员在 `/admin` 先配置允许的教程域名，再创建并启用文章；不提供凭空的默认教程。修改额度和预算不会自动开启 AI。
- `/account` 或插件账号区可申请删除个人采集/AI 数据；需要显式确认，由 worker 分批执行，保留账号，不删除其他用户采集及磁盘上已下载的 CSV。
- `npx --yes pnpm@9.15.4 run test:mysql:m6` 仅用于隔离测试库，会用模拟时钟清理该库到期的测试记录，不能用于业务库。

当前主库已完成 0006。AUTH_SECRET、插件来源 ID、DeepSeek 和 SMTP 仍缺配置；页面可构建，但不能把模拟登录/模型测试当真实服务接通。详细验证、保留期和待办见 M6_VALIDATION。
