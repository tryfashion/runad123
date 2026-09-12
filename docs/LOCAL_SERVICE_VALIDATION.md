# Windows 本地运行验证

## 当前交付

根目录仅保留 start-frontend.bat、start-backend.bat。前者运行 Next.js 网页/API 并构建插件，后者运行 Node worker。窗口退出时 Windows Job Object 终止该窗口下的子进程；MySQL 独立运行，不在停止范围。构建锁和实例锁以项目绝对路径区分。原驻留管理器、start/stop/restart/status/logs-local 和 open-admin-local BAT 已移除。

前端就绪后只打开 /admin/login，不再调用本地登录助手、不创建一小时临时会话。管理员账号密码由 admin:bootstrap 写入 admin_credentials；LOCAL_PREVIEW_ENABLED=true 时两种服务仍禁用 AI 密钥。HTTP 鉴权、CSRF 和 CSV 风险检查要求未改变。

## 本次实测

- 两个 PowerShell 窗口宿主并行启动，共享包构建串行完成；前端健康接口返回 alive，后端日志显示 taskProcessing=true、aiProcessing=false、databaseConfigured=true。
- 再启动前端被实例锁拒绝。
- 强制终止测试前端宿主后，其全部后代进程消失，端口 3000 可重新绑定；后端仍运行。
- 强制终止测试后端宿主后，其全部后代进程消失。
- 使用隐藏的独立测试窗口宿主验证强制退出语义，未操作用户日常窗口的关闭按钮。测试结束两个服务均停止，供用户双击 BAT 手动运行。
- PowerShell HTTP 健康验证首次受本机代理干扰失败；使用仅作用于该请求的 NoProxy 后通过，未修改系统代理。
- 类型检查及格式/浏览器包边界检查通过。无数据库迁移，无 DeepSeek 调用。

## 此前已通过且保持的连接验证

独立 Chromium + 真实本地 MySQL：未登录后台 401、本地管理员后台 200、错误登录桥路径 404 且不设置 Cookie、一次性链接不可重放、生产/远程地址拒绝、Chrome ID 与 CORS 一致、插件匿名安装成功。无 API mock，测试产生匿名安装及管理员审计，不创建商品。截图位于忽略提交的 artifacts/local-admin-preview.png、local-extension-preview.png。

真实 Chrome 工具栏点击、真实 Shopify 商品采集/导入、SMTP 和 DeepSeek 仍待验证。强制关闭在途任务依赖既有租约恢复，不声称本次已验证任务中途断电恢复。

## Chrome 自动分配开发 ID

按用户要求取消 manifest key 和开发公钥生成，本机 .env 不再配置固定插件 ID。仅显式本机预览接受 Chrome 自动分配的合法 ID；生产模式、非回环请求、普通网页和非法来源仍拒绝，/me 等受保护接口仍要求会话。auth 单元用例 24 项通过（新增预览来源及失败分支覆盖）；开发包已重新构建。
- 新 ID 版本已通过独立 Chromium 与真实本地 MySQL 连接冒烟：管理后台访问、Chrome 自动分配 ID、插件匿名安装均通过。Next.js 内部 localhost 地址兼容保留回环及 Host 限制。
