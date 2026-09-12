# M3 持久任务与文本风险检查

2026-09-12。本地实现与自动化验证已完成；真实 DeepSeek 接入、人工质量评估和此前 Shopify/SMTP 外部验收仍未通过，不是生产上线结论。没有执行真实收费 AI 请求。

## 已实现

- 新增 jobs、job_requests、job_attempts、usage_counters、runtime_heartbeats；0003 显式迁移，MySQL 为唯一数据库。主开发库及隔离测试库均已应用。
- API 风险任务创建、读取、显式重试、取消；从服务端 immutable revision 取输入，不接受客户端传风险结论或哈希。草稿返回当前版本 request，插件重开可恢复。
- 同主体输入/国家/商品语言/报告语言/模型/prompt/schema 缓存键；并发幂等、成功缓存 7 天、执行期限 24 小时、失败后显式新 generation。
- SELECT FOR UPDATE SKIP LOCKED 领取，120 秒租约、30 秒续租、fencing token；外呼前写 attempt 并计数，最多 3 次，非法输出最多一次修复。90 秒请求超时、指数退避和抖动，外呼期间不持有数据库锁。
- 全局/主体额度预留，UTC 日归属固定；输入/输出 token 及十进制费用账本，缺用量保留 unknown 费用占用。迟到响应只能补记 attempt 费用，不能覆盖新业务结果。
- 匿名登录开关阻塞、取消释放未使用额度、关闭面板不取消任务。同意关联后面板用新身份向服务端验证权限再恢复，未同意则不可读；恢复阻塞任务新建当前主体 request/job，不迁移原费用历史。
- DeepSeek JSON mode 适配器与 risk-v1 系统提示；无工具、商品文本作为数据。Zod 枚举/交叉关系、quote 原文定位、空输出/截断/非法 JSON 检查。全文 20,000 Unicode 字符和保守 UTF-8 字节 token 上界同时限制，不截取后宣称全文检查。
- 插件原始文本自动检查、当前文本手动检查、状态轮询、取消/重试、结果展示和旧结果标记。切界面语言不重启检查，重试沿用原报告语言。报告只含标题/描述范围说明，不保证法律上无侵权。正式 CSV 导出仍未开放。

## 验证证据

| 检查 | 结果与边界 |
| --- | --- |
| run build | 全工作区通过，最终插件重建通过；Next 使用既有官方 WASM SWC |
| run typecheck | 工作区与工具/测试通过 |
| run lint | Prettier 和浏览器依赖边界通过 |
| vitest run | 7 文件、80 项通过；新增 22 项 M3 测试，数据库事务模型/供应商模拟，不当真实 AI |
| run test:e2e | 8 项通过；真实 Chromium 加载插件，模拟 API 验证草稿/报告恢复、旧文本失效、语言不发请求、错误提示和身份变化后重新验证恢复 |
| test:mysql | 本地真实 MySQL 8.0.46，通过重复迁移、风险幂等、双连接 SKIP LOCKED 领取、租约失效恢复、旧 token 拒绝续租、成功缓存；供应商响应及 SMTP 是模拟 |
| 故障测试 | 三次在途调用模拟中断后最多三次 attempt；旧 worker 迟到成功不会覆盖新结果，unknown 成本补记后只结算一次；取消/阻塞/跨 UTC 日/24h 期限/7 天缓存分别验证 |
| db:migrate | 主 runad123 返回 MIGRATIONS_APPLIED，0000–0003 已应用，共 19 张业务表＋迁移表 |
| 视觉检查 | artifacts/m3-risk-panel.png 已目视查看，400px 窄屏无横向溢出；截图数据为模拟 API，不代表真实 AI 结果 |

进程真实 kill 与重启的线上演练仍待做：当前故障验证为真实数据库租约过期恢复、内存模型中并发停顿/迟到响应，不冒充操作系统进程 kill 已实测。

## 配置和真实验证

1. .env 保留用户已有 MYSQL_URL；填写 AUTH_SECRET、CHROME_EXTENSION_IDS（加载本地插件后取 ID）及 DEEPSEEK_API_KEY。当前这些新增项仍缺失，没有把测试令牌或真实凭据写进文件/日志。
2. 按实际账户核实 AI_MODEL、上下文窗口、输入/输出价格；设置 AI_PRICING_VERSION（建议含生效日期）、AI_INPUT_PER_MILLION、AI_OUTPUT_PER_MILLION、AI_DAILY_BUDGET。单位 USD/百万 token、USD/日。默认不填真实型号和价格。
3. 执行 `npx --yes pnpm@9.15.4 run ai:configure`，只把非敏感参数写入 settings.ai_risk；命令自身不外呼。缺密钥、型号或正数价格/预算会失败，不能默认为无限预算。开启后启动 web 和 worker，用户发起检查才进入付费任务。
4. 真实跑一次经授权的测试商品，核实模型可用性、结果结构、usage 字段、耗时与费用账本，再做错误凭据/超时验证。当前没有执行；使用 JSON mode 不保证结果判断正确。
5. tests/fixtures/risk-review-samples.json 有 30 条候选样本，分普通品名、品牌引用、兼容性表述、授权暗示、含糊名称和提示注入六组。humanLabel/humanReviewer 留空，需要人工标注，再记录模型结果、误报、漏报、无法判断、耗时与费用。它不是人工金标数据，本轮没有风险识别准确率结论。

官方接口依据：[DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode/) 说明 json_object、提示中包含 JSON、输出上限和可能空输出。适配器仍以真实账户联调为最终验证，不把文档阅读当调用成功。

## 已知运行边界

M1 的 access_mode 前置行锁仍串行业务事务，队列单独短锁 job；正确性有测试，吞吐未生产压测。账目 unknown 占用不会自动填零，后续需运维核对。AI 配置管理当前用本地运维命令，M6 再实现相应后台功能。当前账户、店铺、SMTP、真实模型和人工评估的缺口继续保留；下一编码阶段为 M4 改写与确认。
