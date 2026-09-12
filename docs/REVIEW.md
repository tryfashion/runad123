# 设计复查记录

日期：2026-09-12。范围：文档一致性、核心链路、身份、任务/计费、浏览器约束和实施顺序。未编写业务代码，未进行真实集成测试。

结论：原技术路线保留，发现并修复以下设计问题。修订后可进入 M0；不能将文档复查等同于实现已正确或产品一定胜出。

## 跨文档一致性复核（最新）

本轮原因复盘：此前采用局部追加式修改，主表/接口表与补充说明没有一次同步完整。问题的一部分来自新增需求，一部分是维护失误；不能把所有重复发现都解释成正常需求变化。

本轮已改：将 payload_hash、csv_mapping_version、report_locale、配额/清理字段及 job_requests 收回数据库主表；导出许可改为关联实际授权的 risk_request；统一关联匿名历史后的 AI 权限；缩小安装幂等规则至实际适用端点；明确所有额度/job 事务的锁序，分开任务执行截止时间与成功缓存到期时间。没有新增面向用户的功能。

| 完整流程 | 核对落点 | 本轮结论 |
| --- | --- | --- |
| 安装/告知/自动语言 | installation、consent、local preference、M0/M1 | 设计规则有对应入口；初始化不要求先有安装 ID |
| 邮箱登录/关联/退出 | sessions、challenge、draft owner、M1 | 历史草稿与 AI request 使用同一权限规则；原账目不转移 |
| 采集/规范化/草稿 | SourceProduct、capture、revision、M0/M2 | 输入上下文及 hash/映射版本字段已对齐；接口兼容待实测 |
| 原文检查/重试/恢复 | jobs、requests、attempts、usage、M3 | 主表包含必须字段，期限和锁序明确；并发正确性待测试 |
| 改写/接受/重新检查 | PATCH revision、textHash、language、M4 | UI 语言不改商品；改写结果不直接覆盖草稿 |
| 导出/许可/下载事件 | risk_request→job、permit→revision、events、M5 | 检查授权链可追溯；报告主体保持原许可主体 |
| 教程/后台/热度 | locale 查询、ETag、事件 distinct、M6 | 语言缓存和统计口径独立，无销量承诺 |
| 过期/清理/升级/部署 | payload 到期、版本合同、M6/M7 | 规则已有验收位置；真实恢复/清理/部署未测试 |

以上“有规则”仅代表文档闭环，不是自动化测试结果。Shopify 导入、DeepSeek 判断质量、真实权限/并发恢复继续是已知验证项；没有新证据时不重复把这些列为新设计问题。UI 排版、索引性能微调等普通实现选择在所属阶段决定，不继续扩大规划。

## 已修正的问题

| 问题 | 原设计可能造成的后果 | 已落地的修正 |
| --- | --- | --- |
| 令牌自动轮换立即撤销旧值 | 响应丢失后匿名身份无法恢复 | 首版有效会话原 token 续期，撤销/过期另行处理；补弱网验收 |
| 登录挑战的持有证明未明确 | 仅凭 challenge/验证码可能错误绑定安装 | 插件绑定原安装会话；网页绑定 pre-auth cookie；补跨上下文验证 |
| gate 与历史读取规则矛盾 | 开关打开后任务恢复行为因实现者而异 | 只读已有资源例外单独定义；核心写入/新许可仍须登录 |
| local 令牌访问未收紧 | 采集脚本获得不必要的身份权限 | trusted contexts 存储、消息 sender 校验、不提供任意 fetch |
| CSV Blob 生命周期不明确 | 关闭面板导致下载中断或后台调用不存在 API | offscreen 创建 Blob、service worker 管理下载及释放，锁定最低 Chrome API |
| 金额来源和市场未规范 | 价格倍率错误，回退混入不同市场币种 | 每种来源单独适配、只读取 cart currency、实际金额夹具对照、未知阻止导出 |
| ID 先用 number 解析 | 超大 ID 转字符串时已经失真 | 来源 JSON 无损解析，增加超安全整数夹具 |
| 第一次草稿缺目标国家 | 自动风险检查请求缺必填字段 | capture 请求加入 draftContext，用户先选择并记忆 |
| 风险结果仅逐字段校验 | signals_found 却没有 finding 也被当有效 | assessment/severity/findings 交叉约束及完整输入预算 |
| 只有 job 汇总，没有外呼账本 | 崩溃重复调用、未知费用当零、重试次数重置 | job_attempts 持久记录、未知状态、幂等结算、总尝试上限 |
| 30 天正文与 90 天外键引用冲突 | 数据实际删不掉或审计链破坏 | 到期清除正文，保留无正文引用元数据，再按序清理；补 latest 指针处理 |
| 第一次导入到 M5 才验证 | 基础数据不兼容时后期大量返工 | M0 增加采集→最小 CSV→真实导入探针，M5 再验证完整产品流程 |
| 已过期许可仍命中幂等缓存 | 插件拿旧许可继续下载或无限报错 | 返回明确过期错误，新 key 重新申请；映射版本显式匹配 |

## 仍需实测或明确限制

1. **CSV 导入**：目标店实际字段、图片映射、库存/运输/税务字段省略行为，必须由真实导入确认。先验收普通实体商品，不承诺任意 Shopify 页面都支持。
2. **风险质量**：模型能输出合法 JSON 不等于判断正确。M3 建立至少 30 条人工标注样本，覆盖普通品名、明确品牌引用、合法兼容性表述、授权暗示、含糊名称和提示注入；逐项记录误报、漏报、无法判断、耗时和费用。小样本不能宣传为准确率保证。
3. **金额兼容**：Ajax 和公开回退不是同一合同；未知市场不得拼凑。零小数币种的实际接口行为需在探针验证，不能仅凭 Liquid 文档推断所有接口一致。
4. **匿名统计与防滥用**：重装/多浏览器可生成多个身份。限速、预算和去重降低干扰，不能保证自然人数准确或彻底防刷。确认的业务指标只是本站样本的关注和导出行为。
5. **跨店同款**：首版热榜按来源店商品区分，同一个实物被不同店销售仍会分散。必须在后台标“来源商品热度”，不能宣传全网同款热度；待有足够样本再做同款归并。
6. **运行条件**：生产服务器、MySQL 小版本、邮件投递、DeepSeek 模型/费用与 Chrome 发布 ID 仍未接入；版本锁定和兼容测试在 M0 完成。

## 控制首版规模

保留单商品纵向流程，不新增 Redis、跨用户 AI 缓存、复杂登录令牌轮换、广告库、整店抓取和大后台。内部后台先做表格、过滤和简单趋势；教程先配置现有文章链接，不做富文本 CMS。M0 探针之后按 M1–M7 顺序推进，阶段验收失败先修复，不靠堆后续页面掩盖。

## 语言专项复查补记

新增多语言后再次核对，已修正：接口表漏 reportLocale、风险模型输入漏说明语言、错误回退仍强制中文、教程缓存未含语言维度、网站 lang 与手动/自动优先级不清、Chrome locale 目录与应用 BCP 47 值的映射缺失。邮件补 deliveryLocale，AI 重试冻结原报告语言。

商品改写 language 默认 preserve；因此不改写的用户不必选择商品语言，也不会因浏览器中文而改动英文商品。应用语言切换不使已完成检查失效。专项验收已加入 M0/M1/M4/M6，尚未运行实现测试。

### 官方依据

- [Chrome Storage](https://developer.chrome.com/docs/extensions/reference/api/storage)：local 的 content script 可见性与 access level。
- [Chrome Offscreen](https://developer.chrome.com/docs/extensions/reference/api/offscreen)：BLOBS 场景、DOM 能力与版本差异。
- [Chrome 跨源请求](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)：采集脚本与后台的权限边界。
- [Shopify Ajax Product](https://shopify.dev/docs/api/ajax/reference/product)：当前展示币种、cart currency、规格返回上限。
- [Shopify Liquid variant](https://shopify.dev/docs/api/liquid/objects/variant)：零小数币种也有特殊金额表示，不能直接按币种名称猜数值单位。
- [Shopify CSV](https://help.shopify.com/en/manual/products/import-export/using-csv)：CSV 导入规范，仍需以实际导入验收。
