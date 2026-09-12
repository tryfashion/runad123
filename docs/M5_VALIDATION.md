# M5 验证记录

2026-09-12：M5 本地导出闭环已实现。真实 Shopify 导入尚未验证，不能宣称商品导入功能已获生产验收。

## 交付

- csvMappingVersion=1：当前 Shopify 标题字段、规格/图片顺序、规格图片链接、十进制金额、UTF-8 BOM、RFC4180 转义。全部行明确 draft/false；不填写猜测库存、税务或重量。重量只有所有规格已知且整数克时映射，来源已知的小数克拒绝导出。来源未知字段省略，Shopify 仍可能应用其默认值，导入后须核对。
- 许可校验归属、登录开关、当前版本、完整性、有效风险检查、逐项确认、CSV 版本及哈希；10 分钟许可，事件上报 24 小时。需要复核的结果不会自动确认。
- Chrome downloads/offscreen/alarms：后台接管点击、保存许可和下载状态、Blob 生命周期、重启恢复、幂等事件和当前凭据限制。身份改变不使用旧令牌继续上报；状态无法确认时明确显示未确认，不把它记为完成。
- M6 收尾增加既定 handle 默认生成规则的回归验证：标题 slug＋稳定来源指纹，后续文本编辑不改变已有 handle；累计测试数见 M6 记录。
- 0005 新建 export_permits 并为 events 添加许可外键。未部署生产、未启用 AI。

## 验证证据

- 单元测试总数 100 项：包括 9 项 CSV/许可/事件用例，金额三个币种、单/多规格、多图片、公式/引号/逗号/换行/Unicode、权限、过期和幂等。
- 既有 9 项浏览器回归通过；新增 export.spec.ts 独立通过真实 Chromium 下载（API/模型模拟），验证下载文件内容、立即关闭侧栏、完成上报、Blob 清理及重开状态，共 10 项浏览器用例。
- test:mysql 真实隔离库通过，增加许可并发去重、重复完成事件、外键与旧风险拒绝。AI 与 SMTP 仍是夹具。
- 构建、typecheck 已通过；最终格式检查与后续累计结果以 IMPLEMENTATION_PLAN 为准。
- 首次隔离库迁移因 CHAR(36) 字符集与既有 ASCII 主键不一致失败；确认新表未创建后清除该次 applying 标记，修正为 ASCII binary，重跑及幂等重跑通过。未改写已成功迁移的 checksum。
- 浏览器验收修复了动态 import 使后台引用侧栏入口的问题、侧栏异步保存阻止关闭后继续下载的问题；侧栏鉴权采用精确扩展 ID/URL。下载测试使用独立 profile 的默认下载目录；首次遗留的单个合成 CSV 已按名称/大小/内容验证并清除。

## 官方依据与样本

字段依据：[Shopify 当前 CSV 文档](https://help.shopify.com/en/manual/products/import-export/using-csv)。官方 product_template.csv 链接在本环境返回 403，未伪造下载成功。已下载 [Shopify Partners apparel.csv](https://github.com/shopifypartners/product-csvs/blob/master/apparel.csv)，固定于 tests/fixtures/shopify-partners-apparel.csv，SHA-256 为 90291acf9147ab2eeccb7ead518bb5b3dd8900f7285b8cea918403e732c451b3。该样本使用旧列名，不冒充当前模板；当前字段按官方说明映射，正式开发店导入仍需验证。

## 外部待验证

真实 Shopify 开发店导入代表性单/多规格、规格图片和缺失字段样本；确认新列名、图片下载、草稿状态、税务/运输默认值。真实 DeepSeek、SMTP 和人工风险质量缺口延续 M4。程序只能观察浏览器下载，不能确认用户已在 Shopify 导入成功。
