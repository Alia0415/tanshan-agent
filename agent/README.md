# Agent 配置与工具映射

这里是问山自身的配置资料，不是知乎官方导入包或 SDK。

- [SYSTEM_PROMPT.md](SYSTEM_PROMPT.md)：可审阅的人设与对话/工具规则。
- [OPENING.md](OPENING.md)：开场白与跨领域示例。
- 源文件：`src/lib/agent/definition.ts`，修改后运行 `npm run agent:export`。

## 知乎 Skill 对应关系

依据用户提供的 `zhihu` Skill 0.5.3-beta.20260904115023。开发接入走 `references/http-api.md`；已有 MCP 的配置走 `references/mcp.md`，不新建 MCP Server。文档中列出的能力不代表此账号已经获权或联调成功。

| 能力               | Skill CLI 对应  | 本地实现                           | 状态                                      |
| ------------------ | --------------- | ---------------------------------- | ----------------------------------------- |
| 知乎经验与观点     | `search zhihu`  | GET `/api/v1/content/zhihu_search` | 已验证真实搜索调用                        |
| 整理有来源的回答   | `answer`        | POST `/v1/chat/completions`        | 已验证 HTTP 200；兼容无逐条引用的普通文本 |
| 热榜               | `hot`           | 当前无运行时调用                   | 后续按需绑定                              |
| 本人内容/关注/收藏 | `me ...`        | 当前不读取                         | 需明确用途和授权                          |
| 知识库             | `knowledge ...` | 当前不读取/上传                    | 需明确范围和授权                          |

上述路径基于 `https://developer.zhihu.com`。直答保留消息和来源上下文，按 Skill 文档使用 HTTP 多轮能力。普通开发者 Access Secret 仅放服务端。真实账号可在 [知乎开放平台](https://developer.zhihu.com/profile) 配置权限。

当前只检索知乎问题、回答与专栏文章，过滤站外链接、主页和跳转地址。结果先呈现帖子标题、作者、搜索摘要与原帖链接，再提供辅助总结；搜索摘要不等于全文。全网搜索不在当前调用范围内。

## 站内适配点

如果站内入口托管提示词和工具：先确认官方字段、可绑定的工具名称和消息机制，再映射上述人设与能力；不能假定工具标识与开放 API 名称完全相同。

如果站内入口回调业务服务：先实现官方验签与用户/会话映射，再由服务端调用 `receiveAgentMessage(input, ownerToken, provider?)`，将 `presentAgentReply` 的结果转成宿主支持的消息。`ownerToken` 必须来自已验证的身份边界，不可直接信任前端提交的用户 ID。

宿主有模型时可实现 `KnowledgeProvider.generate`；宿主只托管提示词时可以使用相同的对话规则而不运行本地 SQLite 服务。具体形式须以站内协议确定。

本地调试 API 不开放跨域嵌入，也不把删除 X-Frame-Options 当成站内集成。
