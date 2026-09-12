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
13. [M6 验证与使用](docs/M6_VALIDATION.md)：教程、统计后台、删除/保留策略、真实 MySQL 证据与剩余接入项。`r`n14. [宝塔临时部署](docs/BAOTA_DEPLOY.md)：使用 `ads.zhouerp.com` 作为临时域名部署网站/API、worker 和插件 API origin。

## Windows 本地运行

日常只需两个 BAT，双击后保留黑色窗口：

| 文件 | 用途 |
| --- | --- |
| `start-frontend.bat` | 构建网页依赖和 Chrome 插件，运行网站/API；就绪后打开后台登录页 |
| `start-backend.bat` | 构建并运行后台 worker，处理持久任务和维护 |

两个都打开即可，顺序不限；关闭哪个窗口，就停止该窗口对应服务。重启时关闭后再次双击。输出直接显示在窗口，不再使用后台驻留管理器或额外的停止、状态、日志 BAT。前端地址为 `http://127.0.0.1:3000`，插件加载 `apps/extension/dist`；重建后在 Chrome 扩展管理页刷新插件。

沿用 Next.js 网页/API 一体架构，“后端服务”窗口负责 Node worker，不另拆 API 服务。两个窗口使用按项目区分的互斥锁防止重复运行，构建依次执行避免共享包同时写入。Windows Job Object 在窗口进程结束时终止其子进程，避免留下 Next 子进程占用端口，不结束其他项目或本地 MySQL 服务。关闭窗口属于直接停止；后台在途任务按既有租约机制恢复。

端口 3000 被别的程序占用时拒绝启动，不自动改端口或关闭其他项目。需要 Node 24.13+（24.x）和已安装的锁定依赖，不自动安装依赖或迁移数据库。`.env` 的 WEB_ORIGIN 和已设置的 RUNAD_API_ORIGIN 应与上述网址一致。预览模式保留 AI 禁用。浏览器验收前先关闭两个窗口，再按测试要求构建。

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

插件：打开 Chrome 扩展管理页，启用“开发者模式”→“加载已解压的扩展程序”→选择本项目 `apps/extension/dist`，然后固定并点击 runad123 工具栏图标。插件代码改变后，在扩展管理页点刷新并重新点击工具栏图标打开网页内右侧抽屉。M2 使用网页内抽屉/storage/activeTab/scripting 和精确 API host permission；首次采集时按当前站点申请可选权限，已授权站点识别 Shopify 后显示 S 标记。M5 已加入 downloads/offscreen/alarms 权限用于后台下载与状态恢复。不要把开发预览包提交商店。

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

第二个命令需要在 `.env` 填 ADMIN_EMAIL 和 ADMIN_PASSWORD，用于初始化或更新内部管理员密码登录；不输出密码、不写入仓库。管理员从 `/admin/login` 使用账号密码登录后台。普通用户/插件账号仍沿用邮箱验证码；MAIL_MODE=smtp 时需要 SMTP_HOST/PORT/USER/PASSWORD/FROM；默认 disabled。memory 仅用于自动化开发测试，不写验证码日志、不提供公开收件箱，不能打开强制登录开关。

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

当前主库已完成 0006。本地 AUTH_SECRET 与后台连接已配置；本地预览不需要填写插件 ID，DeepSeek 和 SMTP 仍待接入。详细验证、保留期和待办见 M6_VALIDATION。

## 本地预览（暂不接入 AI）

本机配置完成后，双击 `start-frontend.bat` 启动服务，就绪后打开 `http://127.0.0.1:3000/admin/login?lang=zh-Hans`。管理员需要先执行迁移和 `admin:bootstrap`，再用 `.env` 中的 ADMIN_EMAIL/ADMIN_PASSWORD 登录；不再通过本地桥自动免登录进入后台。LOCAL_PREVIEW_ENABLED=true 仍用于本地调试：禁用 BAT 管理进程中的 DeepSeek 密钥，并允许本地 Chrome 自动分配的扩展 ID 调试。

首次本地预览配置命令为 `node scripts/setup-local-preview.mjs`，需先在忽略提交的 `.env` 填好本地 MYSQL_URL 和 WEB_ORIGIN。它补齐空的 AUTH_SECRET，并启用本地预览；不执行数据库迁移。修改后关闭两个窗口，再重新双击启动。预览模式下 BAT 管理的进程禁用 DeepSeek 密钥；以后接入 AI 时先关闭该模式，再按 M3/M4 说明配置。

Chrome 打开 `chrome://extensions`，开启开发者模式，加载 `D:\aiproject\runad123\apps\extension\dist`。首次打开直接显示产品首页；打开 Shopify **商品详情页**，点击采集即可本地预览，无需先登录。选择目标国家后，点击带数据使用说明的“创建草稿”按钮才建立匿名身份并上传。账号表单位于右上角“账号 / 登录”的独立视图。可以查看界面、编辑草稿、查看后台统计和管理教程。AI 风险检查、改写及依赖有效检查的正式 CSV 导出保持不可用；SMTP 登录也仍待接入。插件不设置 manifest key，ID 由 Chrome 自动分配；本机预览无需填写 CHROME_EXTENSION_IDS，正式环境仍使用准确的 ID 白名单。

本地连接冒烟：服务运行时执行 `node --env-file-if-exists=.env --import tsx scripts/test-local-preview.ts`。它使用独立 Chromium 和真实本地库，会产生一条匿名测试安装及本地管理员登录审计，不创建商品或调用 AI；不会把模拟数据注入统计榜单。




## 主题返利链接

管理后台展开“主题返利链接”，添加主题名称、别名（每行一个）、HTTPS 返利网址，勾选启用并保存。完整推广参数原样保存。名称/别名按 NFKC 规范化、忽略大小写和多余空白后精确匹配；例如检测到 `Shine PRO 1.3.0`，可将它作为 `Shine PRO` 的别名，不自动将不相干的定制主题认作同一商品。

插件网站概览先显示主题名，再异步向服务器查询链接；匹配已启用配置时主题名变成可点击推广链接，无匹配、停用或服务失败时保留普通文字。查询仅发送主题名称，不发送访问网站域名和商品内容，不要求用户注册。网站元信息仍按北京时间自然日缓存；返利链接单独查询且不持久缓存，管理员修改后下次进入概览即生效。链接标注推广用途，不自动访问商家网站。

迁移 `0007_theme_links.sql` 为现有 settings 表添加空的 theme_links 配置，不新增数据库服务或业务表。主库已应用迁移，尚未配置真实返利网址。真实佣金归因需使用实际合作方提供的网址另行验证。

