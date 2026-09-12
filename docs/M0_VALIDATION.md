# M0 工具链与验证记录

范围：本地骨架与核心数据探针。未实现 M1–M7 的产品能力。

## 工具链

| 项目 | 固定版本/处理 |
| --- | --- |
| Node | 本机 24.13.0；仓库要求 >=24.13.0 <25，.node-version 记录 |
| pnpm | 9.15.4，packageManager 锁定；启动命令使用 npx 指定版本 |
| Next / React | 16.3.5 / 19.3.0；匹配 React DOM 和 React 类型版本 |
| TypeScript | 5.9.3；主动保留成熟稳定版本，不跟进查询到的 7.x |
| Vite / Vitest | 8.3.0 / 5.0.0；engine 和 peer 支持当前 Node/Vite |
| Drizzle / Kit / mysql2 | 0.45.2 / 0.31.10 / 3.24.4；stable，不使用 RC |
| Zod / tsx / Prettier | 4.6.2 / 4.23.13 / 3.9.6 |
| Playwright | 1.63.0；独立 Chrome for Testing 153.0.8010.12 |
| 用户 Chrome | 读取到 152.0.7977.83；未读取或修改用户浏览数据 |

版本通过 npm registry 的 version/engines/peerDependencies 查询核验，精确写入各 package.json，传递依赖由 pnpm-lock.yaml 固定。MySQL CLI 未在 PATH 发现，不据此推断用户没有 MySQL 服务器。

### Windows 编译器处理

Next 16.3.5 的 @next/swc-win32-x64-msvc 元数据存在，但 tarball 返回 404；初次自动 fallback 又遇到默认缓存目录权限限制。已显式依赖同版 @next/swc-wasm-nodejs，并在 pnpm 中仅忽略该不可下载的 Windows x64 可选包；保留其他平台原生依赖。dev/build 使用 webpack，以支持官方 WASM 后端。构建可能报告 native 未安装，但会使用已锁定 WASM，不需要现场下载编译器。未来是否恢复 native，应以包可下载并通过相同验证为依据。

## 已交付

- 8 个 workspace 项目（根目录＋7 个 app/package），共享包先构建，浏览器包禁止导入 db/server-core/Node 模块。
- 插件 MV3 manifest、service worker、三语言侧栏、auto/手动偏好保存；按钮明确禁用，无虚构功能。
- Next 工作台/状态页和健康接口；无外部字体、无数据采集、无 AI 请求。
- worker 启动、空闲心跳、退出处理；环境变量错误仅输出字段名，不输出凭据。
- MySQL 连接工厂与明确拒绝执行的 M0 迁移占位命令，无建表/连库副作用。
- 开发专用 CSV 探针：无损 ID、整数金额、引号/换行、规格图片、draft；不被 web/extension 引用。
- 词典完整性与 locale resolver、自动化测试、截图、本地启动说明。

## 验证结果

| 验证 | 结果与边界 |
| --- | --- |
| 安装及 frozen lockfile | 通过，精确版本可重用；不自动升级提示中的版本 |
| workspace 类型检查 | 通过，包括工具和测试 TypeScript |
| workspace 构建 | 最终完整 `npx --yes pnpm@9.15.4 run build` 返回 0；共享包、插件、worker、Next 网站均成功构建 |
| 格式和依赖边界 | Prettier 与 check-boundaries 通过；文档不参与代码格式化 |
| 单元测试 | 4 个文件、22 项通过：locale、环境输入、worker、合成 CSV |
| 浏览器测试 | 3 项通过：打包插件重启记忆、网站手动/auto/URL 优先级与窄屏、live/ready 区分 |
| 截图目视检查 | web-desktop、web-mobile、extension-panel 均检查，无明显溢出 |
| worker 退出 | 子进程启动后模拟 SIGTERM 事件验证处理器释放 timer；不是 Windows 系统信号完整验证 |
| CSV 探针 | 生成 1 个商品、2 个规格、3 行 CSV；ID 9007199254740993 无精度丢失；例图为 example.com 占位 |

浏览器测试的第一轮受本机代理拦截 localhost 影响卡住；回环 NO_PROXY 配置后重跑通过。测试使用新建临时 browser profile，清理前检查路径位于 artifacts；未操作用户浏览器标签或扩展。

## 仍未验证

- MySQL 8 真连接、小版本/sql_mode、迁移与事务。M1 接入。
- 真实 Shopify 商品接口、零小数币种、图片下载及实际 CSV 导入。需要可测试商品/店铺；不把合成探针当通过。
- 用户 Chrome 中实际工具栏点击打开原生侧栏；自动化已加载真实扩展并直接验证其侧栏页面，但不冒充点击了浏览器工具栏。
- Chrome 120 最低版本兼容；当前测试用 153，发布前补兼容验证。
- DeepSeek、SMTP、风险识别准确性、登录/额度/统计；分别属于后续阶段。

原生工具栏手工步骤：加载 apps/extension/dist → 固定插件 → 点击图标 → 应打开侧栏 → 选择 English → 关闭再打开 → 仍为 English → 选“Follow browser”恢复自动。生产发布不是 M0 的完成条件。

## 依据

- [Vite build 配置](https://vite.dev/config/build-options)：Chrome target 与 rolldownOptions。
- [Next transpilePackages](https://nextjs.org/docs/app/api-reference/config/next-config-js/transpilePackages)：工作区共享包。
- [Shopify CSV 规范](https://help.shopify.com/en/manual/products/import-export/using-csv)：探针列头和规格图片映射；实际导入仍待验证。
