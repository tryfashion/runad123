# 宝塔临时部署：ads.zhouerp.com

此文档用于把 runad123 临时部署到 `https://ads.zhouerp.com`。当前目标是先让网站后台和插件 API 能在服务器上跑起来；DeepSeek、SMTP、正式插件商店发布可以后续再接。

## 1. 宝塔先建站

在宝塔面板新建网站：

- 域名：`ads.zhouerp.com`
- PHP：纯静态或不启用 PHP 均可
- 数据库：MySQL 8，库名建议 `runad123`
- HTTPS：申请并开启证书
- 强制 HTTPS：开启

DNS 先把 `ads.zhouerp.com` 解析到服务器 IP。确认浏览器能打开 `https://ads.zhouerp.com` 的宝塔默认页后，再部署 Node 服务。

## 2. 服务器环境变量

把仓库根目录的 `.env.production.example` 复制为服务器上的 `.env`，至少修改：

```env
NODE_ENV=production
MYSQL_URL=mysql://runad_app:你的密码@127.0.0.1:3306/runad123
AUTH_SECRET=至少32位随机字符串
WEB_ORIGIN=https://ads.zhouerp.com
ADMIN_EMAIL=admin@你的域名或内部邮箱
ADMIN_PASSWORD=至少8位管理员密码
LOCAL_PREVIEW_ENABLED=false
```

`CHROME_EXTENSION_IDS` 可以先空着，只看后台时不影响。等你加载生产构建的 Chrome 插件并看到插件 ID 后，再填入真实 ID 并重启网站/API。

DeepSeek 和 SMTP 可以先留空。留空时不要把 AI 或邮箱登录当成真实可用功能。

## 3. 构建与初始化

在服务器项目根目录执行：

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install --frozen-lockfile
pnpm run build
pnpm run db:migrate
pnpm run admin:bootstrap
```

`admin:bootstrap` 使用 `.env` 中的 `ADMIN_EMAIL` 和 `ADMIN_PASSWORD` 创建或更新管理员密码登录，不会输出密码。

## 4. 启动 Node 服务

网站/API 服务：

```bash
NODE_ENV=production PORT=3000 pnpm --filter @runad123/web start
```

后台 worker 服务：

```bash
NODE_ENV=production pnpm --filter @runad123/worker start
```

宝塔里可以用 Node 项目管理器、Supervisor、PM2 或 systemd 托管这两个命令。第一阶段可以先只启动网站/API；worker 用于 AI 队列、清理和维护任务。

## 5. 宝塔反向代理

在 `ads.zhouerp.com` 站点中配置反向代理到：

```text
http://127.0.0.1:3000
```

Nginx 需要保留常规代理头：

```nginx
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

部署后检查：

- `https://ads.zhouerp.com/health/live` 应返回 200
- `https://ads.zhouerp.com/admin/login?lang=zh-Hans` 应打开后台登录页

## 6. Chrome 插件连接临时域名

构建连接服务器的插件时，在本机或服务器执行：

```bash
RUNAD_API_ORIGIN=https://ads.zhouerp.com pnpm --filter @runad123/extension build:release
```

然后加载 `apps/extension/dist`。Chrome 显示插件 ID 后，把该 ID 写入服务器 `.env`：

```env
CHROME_EXTENSION_IDS=你的插件ID
```

重启网站/API 服务。正式环境不会接受未列入白名单的 Chrome 插件来源。

## 7. 当前仍待真实验证

- 真实 Shopify 店铺采集与 CSV 导入
- DeepSeek 风险检查与改写
- SMTP 邮箱登录
- 生产清理任务和备份策略
- Chrome 插件固定 ID 或商店发布包

这些完成前，`ads.zhouerp.com` 只能作为临时调试站点，不按正式上线口径报告。
