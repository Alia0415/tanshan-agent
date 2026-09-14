# 探山 Agent

**从一个问题出发，找到适合自己处境的知乎经验与观点。**

探山把问题澄清、知乎检索、回答阅读和多立场讨论连接起来：先理解你的处境，再找到值得读的帖子；用阅读地图和文章速读整理线索，用观点圆桌看见不同立场。覆盖工作、消费、生活、人际关系、技术与学习，不限定提问领域。

[页面预览](#页面预览) · [功能入口](#功能入口) · [快速开始](#快速开始) · [配置说明](#配置说明) · [开发与验证](#开发与验证) · [项目文档](#项目文档)

> 当前提供可本地运行的 Web 应用与 Agent 核心框架，目标是接入知乎站内对话。已实现开放 API 调用和 OAuth 登录接线，**知乎站内 Agent 的注册、宿主消息适配与发布尚未完成**。具体范围见 [Agent 范围说明](docs/AGENT_SCOPE.md)。

## 页面预览

以下为当前应用的本地实拍，采用窄屏布局；点击图片可查看原图。阅读页的热榜内容会随时间变化，圆桌截图展示尚未发起讨论的会场。

| 问答首页 | 阅读发现 | 观点圆桌 |
| --- | --- | --- |
| [![探山问答首页：提问框、智能追问和场景示例](docs/screenshots/home.jpg)](docs/screenshots/home.jpg) | [![阅读发现：热点问题与月亮唱片浏览界面](docs/screenshots/reading.jpg)](docs/screenshots/reading.jpg) | [![观点圆桌：夜间会场、主题切换与 Agent 库](docs/screenshots/roundtable.jpg)](docs/screenshots/roundtable.jpg) |

## 功能入口

| 功能 | 可以做什么 | 本地路径 | 服务依赖 |
| --- | --- | --- | --- |
| 探山问答 | 动态追问、可编辑条件、真实帖子推荐、历史问题与辅助总结 | `/` | 无密钥可体验规则演示；真实资料需要知乎凭证 |
| 知乎阅读 | 热榜与历史热榜、问题搜索、阅读地图、文章速读与总结 | `/reading` | 知乎服务；阅读生成优先使用已配置的 DeepSeek，否则使用知乎直答 |
| 观点圆桌 | 可视化角色、消息同步气泡、议题交锋、分条论据与访客插话 | `/roundtable` | 知乎检索与直答；实验能力 |
| 我的收藏 | 按收藏夹保存帖子、查看原文、整理与移除收藏 | `/bookmarks` 或问答页收藏入口 | 应用内收藏，按匿名浏览器身份隔离；不等同于知乎账号收藏 |
| 我的知乎 | OAuth 登录后查看授权范围内的创作、关注与收藏 | `/me` | OAuth 应用配置与用户授权 |

所有入口由根目录应用统一提供，无需单独启动 `prototype/` 中的历史原型。阅读问题页可以携带问题标题进入问答或圆桌，确认提交后才开始请求。

### 问答如何工作

1. **理解问题**：结合你的原问题、经历和补充信息，判断是否需要追问；最多 5 轮，随时可以跳过。
2. **查找经验**：检索知乎问题、回答与专栏文章；配置 DeepSeek 后可规划检索词并筛选相关结果。
3. **先看来源**：优先展示帖子标题、作者、搜索摘要和原帖链接，最多推荐 5 篇，再提供可展开的辅助总结。
4. **继续调整**：修改已有条件或追问选项，重新检索；也可以从历史问题继续，或把帖子存进收藏夹。

搜索过程中显示当前阶段、已等待时间和预计用时；超过预计时间会明确提示。帖子卡片支持匿名“共鸣”互动，通过地球视图呈现共鸣反馈。

可以试着问：

- “第一次租房，预算有限，签合同前有哪些容易忽略的地方？”
- “想买相机记录旅行，应该先明确哪些需求？”
- “刚开始学习 Python，怎么安排一个能坚持下来的学习计划？”

搜索摘要不等于全文；需要阅读全文时请打开知乎原帖。辅助总结和相关性判断不等于事实核验，普通直答文本不保证提供逐条引用。

### 从发现问题到读懂文章

- **发现问题**：用唱片式界面浏览热榜、切换曾经上榜的问题，也可以搜索自己感兴趣的话题。
- **阅读地图**：进入问题后说明关注点，由阅读助手整理不同方向和候选帖子，支持继续调整阅读视角。
- **文章速读**：帖子详情提供一句话结论、三步动画流程和文章总结，支持重播、生成失败重试及打开知乎原文。
- **继续探讨**：把当前问题带入问答或圆桌，确认后再发起请求。

文章速读与总结基于已有搜索摘要生成，页面会标明尚未获取全文；生成失败时保留明确的错误或摘要回退提示。

### 让不同立场坐到一张桌前

圆桌先检索真实知乎帖子，再组建主持人与 2–3 位立场 Agent。创建过程中会显示检索进度和已找到的资料。

- **消息与角色同步**：收到开场、回复或总结时，对应角色自动出场并显示观点气泡；不需要先点击“自动讨论”。角色表现为动作与文字气泡，不包含语音播报。
- **按议题交锋**：开启自动讨论后，角色围绕 1–3 个议题进行陈述和成对问答；议题澄清、证据不足或达到讨论边界后进入总结，保留共识与分歧。
- **按需看论据**：先看议题和核心观点，再展开分条论据、完整发言和来源链接；缺少有效引用的发言会标记为尚待核实。
- **随时参与**：发送消息加入讨论，或从 Agent 库拖入证据核验员、反方追问者、背景补充员。总结后仍可发言，既有总结不会自动重写。

这些角色由同一个模型通过不同提示词和分配的材料扮演，不代表多个独立模型的事实核验。详细规则与并发保护见 [观点圆桌](docs/ROUNDTABLE.md)。

## 快速开始

需要 **Node.js 24+** 和 npm，项目使用 Node.js 内置 SQLite。

### 1. 获取代码并安装依赖

```sh
git clone https://github.com/Alia0415/tanshan-agent.git
cd tanshan-agent
npm ci
```

### 2. 创建本地配置

Windows PowerShell：

```powershell
Copy-Item .env.example .env.local
```

macOS / Linux：

```sh
cp .env.example .env.local
```

### 3. 启动应用

```sh
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。默认 `WENSHAN_PROVIDER=demo`，未填密钥即可体验问答流程，不查询真实知乎资料，也不生成虚构来源。阅读、圆桌和我的知乎需要分别完成下方配置。

## 配置说明

在根目录 `.env.local` 中修改配置，完成后**重启服务并新建会话**。全部变量见 [.env.example](.env.example)，模型行为、检索策略及调用限制见 [详细配置](docs/CONFIGURATION.md)。

产品已更名为“探山 / Tanshan”，现有 `WENSHAN_*` 环境变量、数据库路径和存储标识保留兼容，**不要仅因品牌改名而替换这些配置名**。

### 接入真实知乎资料

```dotenv
WENSHAN_PROVIDER=live
ZHIHU_ACCESS_SECRET=填入自己的凭证
```

默认由知乎直答生成辅助总结。如果只需要问答中的真实帖子列表，设置 `ZHIHU_GENERATION_MODE=sources`，即可停止该流程的直答调用；这不会关闭阅读或圆桌自身的模型请求。

### 启用模型追问与检索优化

```dotenv
DEEPSEEK_API_KEY=填入自己的密钥
DEEPSEEK_MODEL=deepseek-flash
```

配置密钥后，默认自动启用动态追问，并在真实资料模式下启用检索词规划与相关性筛选。阅读助手也优先使用该模型，未配置时使用知乎直答。

| 变量 | 默认值 | 可选行为 |
| --- | --- | --- |
| `WENSHAN_PROVIDER` | `demo` | `live` 使用真实知乎资料 |
| `WENSHAN_CLARIFICATION_MODE` | `auto` | `local` 使用本地规则；`deepseek` 强制模型追问并要求密钥 |
| `WENSHAN_SEARCH_MODE` | `auto` | `basic` 使用基础关键词检索；`deepseek` 尝试模型优化 |
| `ZHIHU_GENERATION_MODE` | `auto` | `sources` 仅返回问答检索结果 |
| `ZHIHU_ANSWER_MODEL` | `zhida-thinking-1p5` | 问答辅助总结模型 |
| `ZHIHU_TIMEOUT_MS` | `120000` | 知乎请求超时，单位毫秒 |
| `WENSHAN_DB_PATH` | `.data/wenshan-agent-v2.sqlite` | SQLite 持久化路径 |

`auto` 模式根据是否配置 DeepSeek 密钥选择行为。若要让问答演示和 HTTP smoke 不调用外部模型，同时设置 `WENSHAN_PROVIDER=demo` 与 `WENSHAN_CLARIFICATION_MODE=local`。

### 配置知乎 OAuth（可选）

如需使用 `/me`，填写活动项目提供的应用信息：

```dotenv
ZHIHU_OAUTH_APP_ID=填入应用ID
ZHIHU_OAUTH_APP_KEY=填入应用密钥
ZHIHU_OAUTH_REDIRECT_URI=https://你的域名/api/oauth/callback
```

回调地址必须是登记的公网 HTTPS 地址，且与登记值完全一致。配置完成后访问 `/me` 发起登录；能否读取具体内容取决于应用权限和用户授权。

所有密钥仅供服务端使用，不加 `NEXT_PUBLIC_` 前缀，不提交到 Git。开放 API Access Secret、OAuth 用户授权和站内 Agent 发布权限是不同的接入配置。

## 开发与验证

技术栈：**Next.js 16 · React 19 · TypeScript · Node.js SQLite · Zod**。

```text
agent/                  Agent 人设、开场白与工具映射
src/app/                页面与 HTTP 接口
src/lib/agent/          共享指令和文字消息处理入口
src/lib/domain/         问题上下文与追问规则
src/lib/server/         会话、持久化、服务适配与 OAuth
src/lib/reading/        阅读发现与助手逻辑
src/lib/roundtable/     圆桌编排引擎与提示词
tests/                  受控测试
scripts/                导出、冒烟测试与真实联调脚本
docs/                   范围、配置、架构与接口文档
prototype/              历史原型，非主应用启动入口
```

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动开发服务 |
| `npm run check` | ESLint、TypeScript 与受控测试，不调用真实外部模型 |
| `npm run build` | 生产构建 |
| `npm start` | 启动构建后的生产服务 |
| `npm run test:smoke` | 对已启动的 demo 服务验收卡片与文字对话接口 |
| `npm run agent:export` | 从共享定义导出人设与开场白 |

以下为**真实服务联调**，会消耗业务/API 额度，不在 CI 自动执行：

| 命令 | 请求范围 |
| --- | --- |
| `npm run test:zhihu` | 一次知乎搜索与一次直答；`sources` 模式跳过直答 |
| `npm run test:clarification` | 最多 5 次 DeepSeek 请求，验证跨场景追问 |
| `npm run test:search` | 两个虚构需求的搜索前后对比；最多 8 次搜索和 7 次模型调用，不调用直答 |

搜索联调结果写入已忽略的 `.data/search-quality-check.json`，仅用于小样本检查，不代表通用搜索准确率。

GitHub Actions 在 push 和 PR 时运行 `npm ci`、`npm run check` 与 `npm run build`。测试覆盖会话隔离、条件修改、收藏、共鸣、搜索排序、圆桌议题推进、引用校验、并发锁与开场进度流；真实服务的可用性仍需单独联调。

## 部署与运行边界

当前使用**单个 Node.js 实例与持久磁盘**。多副本或临时磁盘 Serverless 部署需要共享存储和持久任务队列。阅读热榜记录存放在 `.data/questions.json`，部署时也应保留 `.data`。

```sh
docker build -t tanshan-agent .
docker run -d --name tanshan -p 3000:3000 --env-file .env.local -v wenshan-data:/app/.data tanshan-agent
```

生产 Cookie 使用 Secure，应通过 HTTPS 反向代理访问。运行环境需能访问知乎及所配置的模型 API，否则页面可打开，但无法读取真实内容。

- **站内接入**：Docker 部署不会自动发布到知乎。宿主消息、身份验签、会话映射与发布协议仍待适配，详见 [接入说明](agent/README.md)。匿名调试 Cookie 不能替代宿主鉴权。
- **数据兼容**：v0.2 通用上下文与旧大学版不兼容。旧数据库保留；显式使用旧数据库时，旧会话返回 `SESSION_VERSION`。
- **输出方式**：问答提供阶段进度，圆桌创建通过 NDJSON 返回检索与组局进度；这不等于模型逐字流式输出。模型失败或降级会明确提示，付费模型请求不自动重试。

## 项目文档

| 文档 | 内容 |
| --- | --- |
| [Agent 范围](docs/AGENT_SCOPE.md) | 当前产品定位与站内适配边界；原 PRD 仅作历史背景 |
| [详细配置](docs/CONFIGURATION.md) | 知乎 Skill 依据、动态追问、搜索质量与模型调用限制 |
| [Agent 配置](agent/README.md) | 人设、开场白、工具映射与宿主接入点 |
| [架构说明](docs/ARCHITECTURE.md) | 模块分工与数据流 |
| [接口文档](docs/API.md) | 问答会话、追问与结果接口 |
| [观点圆桌](docs/ROUNDTABLE.md) | 角色编排、讨论调度与实验边界 |
| [演示脚本](docs/DEMO.md) | 本地演示步骤 |
| [验收状态](docs/ACCEPTANCE.md) | 已验证能力与待完成事项 |
