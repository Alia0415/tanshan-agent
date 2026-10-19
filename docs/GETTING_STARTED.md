# 开始使用

[返回项目首页](../README.md) · [文档导航](README.md) · [配置详解](CONFIGURATION.md)

主应用统一提供 Agent 问答、阅读助手和观点圆桌。三个功能可分别进入，无需启动 `prototype/` 下的原型。

## 1. 准备环境

使用 **Node.js 24+** 和 npm。项目使用 Node.js 内置 SQLite；安装与 CI 均以根目录的 `package-lock.json` 为准。

```sh
git clone https://github.com/Alia0415/tanshan-agent.git
cd tanshan-agent
npm ci
```

复制配置文件：

```powershell
# Windows PowerShell
Copy-Item .env.example .env.local
```

```sh
# macOS / Linux
cp .env.example .env.local
```

## 2. 先跑全站样例

在 `.env.local` 中设置以下值，其他密钥保持为空：

```dotenv
WENSHAN_PUBLIC_DEMO=1
DEEPSEEK_API_KEY=
```

然后启动：

```sh
npm run dev
```

打开 [http://localhost:3000/demo](http://localhost:3000/demo)。此配置使用原创预置资料和本地脚本，不请求外部 API，可以完整体验三个模块的交互。

| 入口 | 可以体验什么 |
| --- | --- |
| `/` | 提问、补充条件、查看推荐资料和辅助总结 |
| `/reading` | 选择问题、生成阅读地图、查看文章思维导图 |
| `/roundtable` | 创建讨论、观看角色发言、推进议题与插话 |

样例资料不是实时知乎内容。需要 AI 生成时，可在服务端填写 `DEEPSEEK_API_KEY`；样例资料不变，追问、总结与讨论会使用 DeepSeek 并消耗额度。具体范围与共享每日预算见 [在线体验说明](ONLINE_DEMO.md#体验范围)。

`WENSHAN_PROVIDER=demo` 是早期问答开关，只覆盖问答检索与回答，不能替代全站样例开关。

## 3. 接入真实服务

在 `.env.local` 中关闭全站样例，并配置知乎开放 API 凭证：

```dotenv
WENSHAN_PUBLIC_DEMO=0
WENSHAN_PROVIDER=live
ZHIHU_ACCESS_SECRET=填入自己的凭证
```

真实知乎资料依赖有效的 `ZHIHU_ACCESS_SECRET`。标准模式下，阅读与圆桌还依赖相应的知乎/模型服务；仅配置 DeepSeek 不能替代知乎内容检索。追问与检索优化默认优先使用 DeepSeek，未配置时可使用知乎助手。可选配置：

```dotenv
DEEPSEEK_API_KEY=填入自己的密钥
DEEPSEEK_MODEL=deepseek-flash
```

如果只需要问答中的真实帖子列表，可设置 `ZHIHU_GENERATION_MODE=sources`，跳过该流程的直答总结；这不会关闭阅读或圆桌的模型请求。

修改配置后，**重启服务并新建会话**。产品已更名为“探山 / Tanshan”，`WENSHAN_*` 环境变量、数据库路径与存储标识仍保留兼容，不要仅因改名而替换。

完整变量见 [.env.example](../.env.example)，模型策略与请求限制见 [配置详解](CONFIGURATION.md)。如需 `/me` 的知乎登录与个人内容，另外按照 [OAuth 文档](OAUTH.md) 配置应用和回调。开放 API 凭证、OAuth 用户授权与站内 Agent 发布是不同的接入步骤。

## 开发与验证

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动开发服务 |
| `npm run check` | ESLint、TypeScript 与受控测试，不调用真实外部模型 |
| `npm run build` | 生产构建 |
| `npm start` | 启动已构建的生产服务 |
| `npm run agent:export` | 从共享定义导出人设与开场白 |

GitHub Actions 使用 Node.js 24，执行 `npm ci`、`npm run check` 与 `npm run build`。贡献与人工验证约定见 [贡献指南](../CONTRIBUTING.md)。

### 对已启动的本地服务做 HTTP 验收

- 全站脚本样例：使用上述 `WENSHAN_PUBLIC_DEMO=1` 且 DeepSeek 密钥为空的配置，运行 `npm run test:public-demo`。脚本先核对服务模式与 AI 是否关闭，再验证阅读、问答和圆桌。
- 早期问答接口：单独使用 `WENSHAN_PUBLIC_DEMO=0`、`WENSHAN_PROVIDER=demo`、`WENSHAN_CLARIFICATION_MODE=local` 启动服务，再运行 `npm run test:smoke`。

两者默认访问 `http://127.0.0.1:3000`；可用 `WENSHAN_TEST_URL` 指定测试服务。不要将旧问答 smoke 用于真实服务或全站样例。

### 真实服务联调

以下脚本由开发者按需手动执行，会请求上游并消耗业务/API 额度，不在 CI 中自动运行：

| 命令 | 请求范围 |
| --- | --- |
| `npm run test:zhihu` | 一次知乎搜索与一次直答；`sources` 模式跳过直答 |
| `npm run test:clarification` | 最多 5 次 DeepSeek 请求，验证跨场景追问 |
| `npm run test:search` | 两个虚构需求的检索对比，最多 8 次搜索和 7 次模型调用，不调用直答 |

搜索联调记录写入已忽略的 `.data/search-quality-check.json`。这些小样本用于检查流程，不代表通用搜索准确率。

## 部署

应用需要运行 Node.js 服务，不能作为纯静态站点部署。当前采用单实例与持久磁盘，`.data` 包含 SQLite 与阅读目录，应整体保留。

公开样例使用 [在线体验部署指南](ONLINE_DEMO.md) 中的 Docker Compose 与 HTTPS 反向代理模板。标准模式的基础 Docker 启动方式：

```sh
docker build -t tanshan-agent .
docker run -d --name tanshan -p 3000:3000 --env-file .env.local -v wenshan-data:/app/.data tanshan-agent
```

生产环境通过 HTTPS 访问，以保持 Secure Cookie 会话。模型与知乎请求所需的网络、持久化和多实例限制见 [部署指南](ONLINE_DEMO.md#部署条件)。

## 常见问题

**Node.js 启动时报 SQLite 或版本错误？** 先运行 `node --version` 确认当前终端使用 Node.js 24+，再执行 `npm ci`。

**没有密钥，为什么阅读或圆桌仍提示缺少服务？** 确认设置的是 `WENSHAN_PUBLIC_DEMO=1`，并重启服务。`WENSHAN_PROVIDER=demo` 只切换问答。

**改了配置，旧问题仍保留原来的结果？** 重启后新建会话。既有答案会保留创建时的条件和结果，不会因修改环境变量自动重算。

**有 DeepSeek 密钥，为什么找不到真实知乎资料？** DeepSeek 负责模型生成，真实检索仍需有效知乎凭证。检查当前模式及服务端配置，参考 [配置详解](CONFIGURATION.md)。

**知乎登录后返回错误，或线上会话无法保持？** 核对回调地址与平台登记值完全一致，并使用 HTTPS；详细步骤见 [OAuth 文档](OAUTH.md)。

**网页运行成功就等于发布了知乎站内 Agent 吗？** 网页和调试 API 已可运行；站内宿主鉴权、事件适配与发布仍需独立完成，见 [Agent 范围说明](AGENT_SCOPE.md)。
