# 模型、检索与接入配置

[返回项目首页](../README.md) · 基础环境变量见 [配置示例](../.env.example)。

## 使用知乎提供的 Skill

开发依据为用户提供的 `zhihu` Skill **0.5.3-beta.20260904115023**：`SKILL.md`、`references/http-api.md`、`references/mcp.md` 和 `references/hackathon.md`。Skill 允许开发接入场景直接使用 HTTP 文档，因此运行时通过服务端 HTTP 调用，无需把 CLI 安装到服务器。

工具映射见 [agent/README.md](../agent/README.md)。仅调用知乎搜索，收录知乎问题、回答与专栏文章；过滤站外页面、主页、跳转链接和非帖子类型。保留标题、作者、搜索摘要与原始链接，包括原有追踪参数。搜索摘要不等于全文，需要阅读全文时打开知乎原帖。默认最多两条查询，相关结果不足时最多补搜一次，总搜索调用最多三次。限流和鉴权失败立即停止，直答 POST 不自动重试。直答实际可能返回 Markdown 文本，不能假定提供逐条引用。站内宿主行为仍待协议与联调。

## 动态追问

在 `.env.local` 添加 `DEEPSEEK_API_KEY=自己的密钥` 即可启用动态追问。默认模型为 `deepseek-flash`，可用 `DEEPSEEK_MODEL` 覆盖。模型根据原问题、补充和历轮问答，每轮生成一个具体问题和可选回答；每轮重新判断，信息足够就自动开始回答，最多 5 轮，可随时跳过。选项和自由补充连同所回答的问题进入后续检索和总结。密钥只在服务端读取。

`WENSHAN_CLARIFICATION_MODE=auto` 自动根据密钥选择；`deepseek` 强制使用模型并要求密钥；`local` 强制本地规则演示。完全离线的演示/HTTP smoke 应同时设置 `WENSHAN_PROVIDER=demo` 和 `WENSHAN_CLARIFICATION_MODE=local`。模型失败会显示可重试的错误，保留原卡片和输入，不冒充动态追问、不自动重试付费请求；仍可跳过已有追问。

接入依据：[DeepSeek JSON 输出](https://api-docs.deepseek.com/guides/json_mode/)与[对话接口](https://api-docs.deepseek.com/api/create-chat-completion/)。使用原生 fetch、非思考模式和结构校验，服务端超时 30 秒，页面提交等待 45 秒。

### 搜索质量

配置了 DeepSeek 密钥后，真实资料模式默认同时启用检索词规划和相关性筛选，无需新密钥。读取全部补充与问答，生成 1–2 条简短、互补的查询；每条最多取 10 个候选，去重后按内容与条件评估，最终展示最多 5 篇。只命中关键词但答非所问、明确违反硬限制的内容会被过滤；缺少价格等信息的有用内容保留待核对说明。直接相关结果少于 3 篇时最多补搜一次，总搜索调用不超过 3 次；已有至少 3 篇直接相关结果时，不为凑满 5 篇而补入弱相关背景资料。

相关性与条件匹配度相同时，综合评论数、赞同数和更新时间排序，优先互动较多、时间较近的帖子。使用知乎接口原始 `CommentCount`、`VoteUpCount`、`EditTime`，卡片与文字回复显示实际数值；缺失或非法数据不补成 0。互动量按对数递减加分，避免历史爆款的累计数字压过所有新内容；高热度不能跨越相关性和条件层级。时间字段按「更新于」标注，不当作首次发表时间，也不保证内容中的价格或观点仍然有效。基础检索和模型完全降级时保留原检索顺序，避免未判定相关性就只按热度重排。

`WENSHAN_SEARCH_MODE=auto` 根据密钥启用；`basic` 使用原关键词方式；`deepseek` 尝试模型优化。模型规划/筛选失败时明确提示降级，不自动重试付费模型请求；补搜评估失败也不会重新展示已判定无关的帖子。候选 ID 和支持筛选的原文片段必须通过校验，模型不生成标题、作者或链接。相关性判断不等于事实核验。

正常增加一次规划和一次筛选模型调用，补搜有新结果时再筛选一次；每次搜索优化模型请求最多等待 20 秒。既有的知乎限流、鉴权停止、条件版本和生成幂等机制继续生效。可运行 `npm run test:search` 进行显式真实联调，结果写入已忽略的 `.data/search-quality-check.json`。该小样本检查不能当作通用搜索准确率评测。

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


