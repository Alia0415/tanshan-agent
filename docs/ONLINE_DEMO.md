# 在线体验与腾讯云部署

**[打开在线体验](https://tanshan-270489-8-1443398117.sh.run.tcloudbase.com/demo)** · [返回项目首页](../README.md) · [本地运行](GETTING_STARTED.md)

本仓库提供使用原创预置样例的 AI 体验模式和部署模板。当前公开入口使用 `/demo`；以下说明也适用于自行部署，部署后的功能与额度以该服务端配置为准。

## 体验范围

设置 `WENSHAN_PUBLIC_DEMO=1` 后，问答、阅读与圆桌使用内置的相机选择、AI 学习、转岗验证三组原创样例，不调用知乎或知乎 OAuth。配置 `DEEPSEEK_API_KEY` 时保留 AI 追问、总结和讨论，模型请求会消耗 DeepSeek 额度；未配置密钥时使用完整的本地脚本样例，不调用外部 API。页面会标注样例身份；样例不代表实时热榜或真实搜索结果，AI 输出中的引用也不代表事实核验。历史按浏览器匿名身份保存；原创样例不提供知乎收藏和共鸣互动，知乎账号登录与账号内容不可用。

公开体验默认每天共享 **200 次 DeepSeek 上游请求**，在 UTC 每日 `00:00` 刷新（北京时间 `08:00`）。这是请求次数，不是访客数或问题数：追问、总结和多轮圆桌可能各自消耗次数。每次真实模型请求前先预约次数，失败的请求也不退还本地次数；用完后返回“今天的 AI 体验次数已用完，请明天再试。”。计数写入 SQLite，仅保留近 7 天记录。单实例使用持久化数据库时，计数在重启后保留；临时磁盘被回收会重置计数，多个独立实例也各自计数，不能据此保证全站额度。它限制请求次数，不是精确的金额上限。

`WENSHAN_PROVIDER=demo` 是原有问答开关，仅跳过问答的真实检索和答案生成，不能单独代替全站体验模式。`WENSHAN_PUBLIC_DEMO=1` 优先拦截知乎请求，即使旧知乎凭证仍存在也不会调用；部署模板会清空知乎与 OAuth 变量，仅允许显式传入 DeepSeek 配置。

| 入口 | 用途 |
| --- | --- |
| `/demo` | 说明样例范围并进入各功能 |
| `/`、`/reading`、`/roundtable` | 问答、阅读和圆桌样例 |
| `/api/health` | 返回 `status`、`mode` 与 `aiEnabled`，供容器和部署检查；不验证模型密钥是否有效 |

## 部署条件

使用腾讯云 CVM 或轻量应用服务器上的 Linux、Docker Engine 与 Docker Compose 插件。轻量服务器可参考腾讯云官方的 [Docker 容器环境教程](https://cloud.tencent.com/document/product/1207/60423) 和 [容器管理说明](https://cloud.tencent.com/document/product/1207/60329)。本方案在服务器本地构建镜像，通过 Compose 启动。

应用包含 Next.js 服务端接口、SQLite 和文件存储，必须运行 Node.js 服务，不能只将构建产物上传为静态站点。保持单个应用实例，将整个 `/app/.data` 放到持久卷中；不要以多个副本共享同一个 SQLite 文件。

公网入口需要域名、TLS 证书与 HTTPS 反向代理。生产环境 Cookie 使用 `Secure`，直接通过公网 HTTP IP 访问会导致会话、历史或收藏无法正常保持。将域名解析到服务器，并按所选地域和腾讯云指引完成域名与网站配置。安全组和服务器防火墙向访客开放 80/443；应用的 3000 端口只监听本机回环地址。

### 腾讯云云托管（控制台部署）

在云托管中使用仓库根目录的 `Dockerfile`，服务端口设为 `3000`，并在**运行环境变量**中设置 `WENSHAN_PUBLIC_DEMO=1`、`DEEPSEEK_API_KEY` 和 `DEEPSEEK_MODEL=deepseek-flash`。保存后部署新版本，将线上流量切到该版本，再访问 `/api/health`，确认 `mode` 为 `demo`、`aiEnabled` 为 `true`；这只确认已读取密钥，不验证密钥有效性。

当前部署将**最大实例数设为 1**，建议最小实例数也设为 1，避免闲置缩容造成的冷启动。发布切换期间也不要依赖不同版本间的本地状态一致。[腾讯云临时存储文档](https://docs.cloudbase.net/run/deploy/configuring/storage/local)说明，每个实例的临时存储彼此独立，实例回收或销毁后数据会清除；因此仅配置 `WENSHAN_DB_PATH` 不能让临时磁盘变成持久存储。

体验模式的当前圆桌会在浏览器本地保存会话内容和服务端签名检查点。数据库记录丢失后，同一浏览器保留原匿名 Cookie、检查点未过期且签名密钥一致时，可以恢复圆桌并继续讨论；服务端仍校验归属、内容签名和原有效期。检查点不包含 Cookie 或 API 密钥原文，且仅恢复当前圆桌，不能恢复问答、阅读历史、每日 AI 计数或互斥锁。清除浏览器数据、换浏览器、超过有效期，或旧版本没有保存检查点时，无法用它恢复。

独立部署建议配置可选的 `WENSHAN_DEMO_SESSION_SECRET`，值使用自行生成并保存在服务端的随机长密钥。留空时使用 DeepSeek 密钥派生专用于检查点签名的密钥；两者都未配置时仅使用进程内随机密钥，无法跨实例或重启恢复。更换签名密钥（或在未配置独立密钥时更换 DeepSeek 密钥）会使旧检查点失效；若数据库原记录仍在，仍可继续读取该记录。

圆桌恢复不替代共享数据库。当前 SQLite 中的每日预算与互斥锁只在使用同一个数据库的进程间生效；即使单实例，临时数据库被销毁后也会丢失预算。需要严格全站限额或运行多个副本时，应先将预算、圆桌状态和并发控制迁移到外部共享数据库或队列。不要把 SQLite WAL 数据库挂到 NFS/COS 上作为多副本方案；[SQLite 官方文档](https://sqlite.org/wal.html)明确 WAL 依赖同主机共享内存，不支持网络文件系统。

## 1. 配置 AI 并启动体验服务

在服务器获取仓库后，在仓库根目录复制配置示例：

```sh
cp deploy/demo.env.example .env.demo
```

编辑 `.env.demo`，填写服务端 DeepSeek 密钥。保留空值则使用本地脚本回退；默认模型为 `deepseek-flash`。填入密钥的 `.env.demo` 不应提交到仓库。

```dotenv
DEEPSEEK_API_KEY=填入自己的密钥
DEEPSEEK_MODEL=deepseek-flash
WENSHAN_DEMO_SESSION_SECRET=
WENSHAN_DEMO_DAILY_AI_LIMIT=200
```

`WENSHAN_DEMO_DAILY_AI_LIMIT` 必须是有效正整数，非法值会报配置错误，不会变成无限额度。该预算只在 `WENSHAN_PUBLIC_DEMO=1` 时生效。密钥和预算配置都由服务端读取，密钥不要使用 `NEXT_PUBLIC_` 前缀。`WENSHAN_DEMO_SESSION_SECRET` 可留空；若填写，后续重启和发布应保持相同值。

然后构建并启动：

```sh
docker compose --env-file .env.demo -f deploy/compose.demo.yml up -d --build
docker compose --env-file .env.demo -f deploy/compose.demo.yml ps
curl -fsS http://127.0.0.1:3000/api/health
```

健康检查应返回：

```json
{"status":"ok","mode":"demo","aiEnabled":true}
```

模板使用现有 Dockerfile、一个应用容器与一个命名持久卷。Docker 构建排除 `.env*`，运行时不读取 `.env.local`。Compose 通过 `--env-file .env.demo` 为明确列出的 DeepSeek 与预算变量提供值，知乎与 OAuth 变量仍固定为空，不会将整份环境文件注入容器。若服务器当前 shell 也设置了这些变量，Compose 会优先使用 shell 值，启动前请确认它们符合预期，不要打印密钥。

首次构建需要网络下载基础镜像和 npm 依赖；AI 体验运行时需要访问 DeepSeek，但不会请求知乎。健康检查检查应用模式和数据库是否可读写；`aiEnabled` 只表示存在 DeepSeek 密钥，不请求或验证模型 API。密钥留空时为 `false`。

## 2. 配置 HTTPS 反向代理

使用服务器上的 Nginx，将 [反向代理模板](../deploy/nginx.demo.conf) 中的 `demo.example.com`、证书路径和私钥路径替换为实际值。可将修改后的文件放到系统 Nginx 会加载的配置目录，再检查并重载：

```sh
sudo nginx -t
sudo systemctl reload nginx
```

模板将 HTTP 重定向到 HTTPS，并向应用传递原始 Host 和协议。`proxy_buffering off` 与 300 秒读取超时用于保留创建圆桌等接口的进度流。模板针对与应用同一台服务器上的 Nginx；若 Nginx 运行在另一个容器或另一台机器，需调整上游地址和网络配置。

## 3. 公网验收并添加仓库入口

使用真实域名打开 `/demo`，确认问答、阅读和圆桌均标注样例，选择主题、提交问题、生成阅读地图并推进圆桌；有 DeepSeek 密钥时这些操作会发起计费模型请求，留空时可先验证脚本流程。刷新后检查同一浏览器的历史仍可读取。再通过 HTTPS 请求 `/api/health`，应返回 `mode: "demo"`，AI 是否启用仍以实际配置与页面提示为准。

圆桌组局完成后，按页面指引点击底部“自动讨论”，角色会逐轮发言；点击“暂停讨论”即可暂停并插话，随后点击“继续自动讨论”恢复推进。若服务端会话确已失效，页面会保留当前已展示的内容，并提供“重新发起”入口；旧版本创建且没有签名检查点的圆桌需要重新发起。

对专门关闭了 DeepSeek 的体验服务可运行 `WENSHAN_TEST_URL=https://你的域名 npm run test:public-demo` 做 HTTP 验收；脚本发现 `mode` 不是 `demo` 或 `aiEnabled` 不是 `false` 时立即退出，不执行生成请求。有密钥路径由默认 `npm test` 的 mock 测试覆盖，真实联调需单独验证密钥与额度。

确认 HTTPS、样例提示和功能流程均正常后，在 README 中添加“在线体验”链接，填写实际可访问的 HTTPS 地址。模板里的域名仅为占位值。

## 更新与持久化

更新代码后再次执行构建启动命令：

```sh
docker compose --env-file .env.demo -f deploy/compose.demo.yml up -d --build
docker compose --env-file .env.demo -f deploy/compose.demo.yml logs --tail=100 app
```

命名卷会保留 SQLite、收藏和阅读目录等运行数据。备份整个数据卷；停止服务时使用 `docker compose --env-file .env.demo -f deploy/compose.demo.yml down` 会保留卷。不要在需要保留数据时使用 `down -v`。

## 知乎凭证恢复后切换正式模式

样例模式不修复过期的知乎凭证。恢复真实资料需要有效的 `ZHIHU_ACCESS_SECRET`；知乎 OAuth 的应用凭证和用户授权另行配置。DeepSeek 当前用于追问、检索规划和阅读助手，不能替代知乎内容检索，圆桌的真实模式仍依赖知乎检索与直答。

为正式服务使用单独的运行配置，设置 `WENSHAN_PUBLIC_DEMO=0`、`WENSHAN_PROVIDER=live`，并在服务器端注入有效凭证，重启后新建会话。不要直接复用本体验 Compose：它固定启用样例资料并清空知乎与 OAuth 凭证。标准模式的 `/api/health` 返回 `mode: "standard"`，仅表示服务在运行，不验证上游凭证或额度。模型、OAuth 与资料范围详见 [配置说明](CONFIGURATION.md)。
