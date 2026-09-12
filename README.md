# 问山 Agent

面向**知乎站内对话**的通用问答 Agent 框架。先理解问题，必要时追问一两句，再查找匹配的知乎帖子。结果优先展示标题、作者、摘要与原帖链接，AI 辅助总结可展开查看。覆盖工作、消费、生活、人际关系、技术与学习，领域不设固定枚举。

用户最新范围以 [Agent 范围说明](docs/AGENT_SCOPE.md) 为准；原 PRD 保留为历史背景。

## 交付内容

- `agent/`：Agent 人设、开场白、示例问题和知乎 Skill 工具映射。
- `src/lib/agent/`：共享指令与文字消息处理入口，不依赖浏览器 DOM、表单或 Next.js。
- `src/lib/domain/`：通用目的、背景、限制与关注点；最多两轮可跳过追问。
- `src/lib/server/`：会话、身份隔离、版本与生成幂等；知乎帖子搜索、知乎直答适配。
- `src/app/`：本地调试页面和应用 HTTP 接口，方便验证 Agent 的行为。

**站内适配尚未完成。** 用户提供的知乎 Skill 描述了开放 API、CLI 和现有 MCP 服务，没有提供站内 Agent 的注册、消息事件、鉴权或发布协议。因此本仓库不声明官方 manifest/webhook，不创建新的 MCP Server，也未将本地页面作为 iframe 嵌入知乎。拿到实际站内创建入口及协议后，将宿主事件映射到 `receiveAgentMessage`；如果宿主直接托管提示词与工具，则使用 `agent/` 中的配置内容并按宿主要求绑定工具。

## 使用知乎提供的 Skill

开发依据为用户提供的 `zhihu` Skill **0.5.3-beta.20260904115023**：`SKILL.md`、`references/http-api.md`、`references/mcp.md` 和 `references/hackathon.md`。Skill 允许开发接入场景直接使用 HTTP 文档，因此运行时通过服务端 HTTP 调用，无需把 CLI 安装到服务器。

工具映射见 [agent/README.md](agent/README.md)。仅调用知乎搜索，收录知乎问题、回答与专栏文章；过滤站外页面、主页、跳转链接和非帖子类型。保留标题、作者、搜索摘要与原始链接，包括原有追踪参数。搜索摘要不等于全文，需要阅读全文时打开知乎原帖。默认最多两条查询，无结果时最多简化一次，总搜索调用最多三次。限流和鉴权失败立即停止，直答 POST 不自动重试。直答实际可能返回 Markdown 文本，不能假定提供逐条引用。站内宿主行为仍待协议与联调。

## 本地运行

使用 Node.js 24（SQLite 使用 Node.js 内置模块）：

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

打开 [本地调试入口](http://localhost:3000)。默认 `WENSHAN_PROVIDER=demo`，不发起外部 API 请求，不生成虚构来源。

启用真实资料时在 `.env.local` 设置：

```dotenv
WENSHAN_PROVIDER=live
ZHIHU_ACCESS_SECRET=填入自己的凭证
ZHIHU_ANSWER_MODEL=zhida-thinking-1p5
ZHIHU_TIMEOUT_MS=120000
ZHIHU_GENERATION_MODE=auto
```

凭证仅供服务端使用，不能加 `NEXT_PUBLIC_` 前缀或提交到 Git。切换配置后重启并新建会话。Access Secret 用于开放 API，不等同于知乎站内 Agent 身份或发布权限。

直答额度不足时，可设 `ZHIHU_GENERATION_MODE=sources`：保留真实帖子列表，停止调用直答。恢复辅助总结时改回 `auto` 并重启。普通直答文本单独标注为待核对，检索帖子不冒充正文的逐条证据。

## 验证与配置

| 命令                   | 用途                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `npm run agent:export` | 从共享定义导出可阅读的人设与开场白                                                         |
| `npm run test:zhihu`   | 显式真实联调：一次知乎搜索与一次直答；sources 模式跳过直答，消耗业务额度，不在 CI 自动执行 |
| `npm run check`        | 代码规范、类型检查和受控测试                                                               |
| `npm run build`        | 生产构建                                                                                   |
| `npm start`            | 启动调试服务的生产版本                                                                     |
| `npm run test:smoke`   | 对已启动的 demo 服务验收卡片与文字对话接口                                                 |

[接口文档](docs/API.md) · [架构](docs/ARCHITECTURE.md) · [演示脚本](docs/DEMO.md) · [验收状态](docs/ACCEPTANCE.md)

## 运行边界

当前采用单个 Node.js 实例与持久磁盘；多副本或临时磁盘 Serverless 需要共享存储及持久任务队列。匿名 Cookie 只服务于本地调试，不能替代站内宿主鉴权。

v0.2 通用上下文与旧大学版不兼容。默认数据库改为 `.data/wenshan-agent-v2.sqlite`，旧数据库保留；显式使用旧数据库时旧会话返回 `SESSION_VERSION`，不会误用旧条件。

Docker 可运行调试后端，但不是发布到知乎的操作：

```sh
docker build -t wenshan-agent .
docker run -d --name wenshan -p 3000:3000 --env-file .env.local -v wenshan-data:/app/.data wenshan-agent
```

生产 Cookie 使用 Secure，HTTP 路由应置于 HTTPS 反向代理之后。原型尚未提供通用模型意图识别、逐字流式输出或站内发布集成。
