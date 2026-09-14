# 应用 HTTP 接口

这是探山自己的协议，不是知乎原生 API。所有写请求均使用 `Content-Type: application/json`，浏览器同源访问，携带自动设置的 `wenshan_browser` HttpOnly Cookie。ID 不能单独作为访问凭证。响应不缓存。

| 方法与路径                              | 请求                                               | 响应                                           |
| --------------------------------------- | -------------------------------------------------- | ---------------------------------------------- |
| `POST /api/sessions`                    | `{question}`                                       | 201 `{session, auto_answer}` 并设置匿名 Cookie |
| `GET /api/sessions/:id`                 | 无                                                 | 200 `{session}`                                |
| `POST /api/sessions/:id/clarifications` | `{context_version, selections?, answer?, free_text?, skip?}` | 200 `{session, auto_answer}`                   |
| `PATCH /api/sessions/:id/context`       | `{context_version, changes, free_text?}`           | 200 `{session}`，新版本 ready                  |
| `POST /api/sessions/:id/answer`         | `{context_version, request_id}`                    | 202 `{session}`，通过 GET 查询进度             |
| `POST /api/sessions/:id/feedback`       | `{answer_id, type, reason?}`                       | 200 `{received:true}`                          |

`question` 去除首尾空白后 1–2000 字符，单个补充最多 2000 字符，会话补充累计最多 16000 字符（包括追问文本，容纳 5 轮）。关注点最多两项，字段选择只允许当前卡片提供的字段。`changes` 可编辑所有条件字段，传 `null` 清除可选字段。`purpose`：`understand`、`decide`、`solve`、`overview`；`priorities` 为字符串数组。

动态卡片为 `clarification.kind=contextual`，`title` 是具体追问，`description` 是简短说明，`options` 是 0–5 项单选文本，`placeholder` 是输入提示，`fields=[]`。提交 `answer` 时必须与当前卡片中的选项完全一致（最多 120 字符）；也可只提交 `free_text` 或两者一起提交。`clarification_history` 保存实际问题和用户回答，不将模型问题提取为用户事实。旧 `purpose/details` 卡片仍支持原 `selections` 协议。

最多 5 轮追问，信息足够、明确跳过或达到上限时返回 `ready`；动态卡片结束后 `auto_answer=true`。模型 HTTP/JSON 失败不推进版本和轮次，客户端可重试原输入或跳过；`CLARIFICATION_AUTH/LIMIT/INVALID/UNAVAILABLE` 分别表示密钥、额度、格式、连接问题。模型请求在事务外执行，落库前重新核对版本。不要自动重放创建/追问请求。

`request_id` 是客户端生成的 UUID。重复 ID 返回当前会话，不重复调用。相同会话在生成中使用不同 ID 也不启动第二个任务。同版本已有答案时直接复用；失败后的手动重试需要新 ID。旧 `context_version` 返回 409，不自动迁移请求。

反馈 `type` 为 `helpful` / `irrelevant`，原因最多 500 字符。一个答案保留该匿名用户最后提交的一条反馈。

## 错误

统一结构：`{error:{code,message}}`。HTTP 校验错误立即返回；已经接受的后台生成失败体现在 `session.stage=error` 和 `session.error`。

| code                                     | 含义                               |
| ---------------------------------------- | ---------------------------------- |
| `VALIDATION_ERROR` / `INVALID_SELECTION` | 参数不合规                         |
| `SESSION_NOT_FOUND`                      | 会话不存在、过期或匿名凭证不符     |
| `CONTEXT_CHANGED`                        | 使用了旧条件版本                   |
| `INVALID_STAGE`                          | 当前状态不支持该操作               |
| `AUTH_REQUIRED` / `AUTH_INVALID`         | 上游凭证缺失或权限失败             |
| `RATE_LIMITED`                           | 上游额度或频率受限                 |
| `TIMEOUT`                                | 请求截止时间已到                   |
| `INTERRUPTED`                            | 上次进程中的生成中断，需要手动重试 |
| `INCOMPLETE` / `INVALID_RESPONSE`        | 上游结果不完整或不可解析           |

客户端在网络错误后应先查询状态。不要自动重复提交一个新的收费生成请求。

## 通用条件

Context: topic（讨论对象，最多 100 字符）、purpose、scenario（场景，最多 500 字符）、constraints（限制，最多 500 字符）、priorities（最多两项，每项 40 字符）。没有学校、专业、校区或高考省份的固定字段。

## 文字 Agent 调试接口

POST /api/agent/messages 接收 message（1–2000 字符）、request_id（UUID），继续对话时同时带 session_id（UUID）与 context_version（正整数）。身份仍由 HttpOnly Cookie 确定，不接受客户端提交 ownerToken。

返回 session_id、context_version、stage、text、provider，以及可选 clarification 和 answer。宽泛问题返回追问；清晰问题或完成补充后自动生成。可直接回复自然语言、当前选项全文或对应编号；动态卡片会将编号解析为选项文本，不强制结构化表单。

本接口等待处理完成，当前没有流式输出。发生断线时先 GET /api/sessions/:id 检查是否仍在生成。后续消息携带旧版本会返回 409；首次消息创建暂不提供宿主事件级幂等。不要将此调试协议直接注册为未经确认的知乎 webhook。

错误 SESSION_VERSION（410）表示旧版大学演示会话，需要新建，不会自动迁移或覆盖原记录。

## 回答形式

answer.sources 只包含知乎问题、回答和专栏文章，URL 为知乎原帖地址。title、author、excerpt 来自知乎搜索，其中 excerpt 是搜索摘要，不是帖子全文。卡片和 text 结果先展示帖子列表；卡片的 AI 辅助总结默认折叠。旧会话数据不改写，展示时过滤历史站外资料，并隐藏依赖这些资料的旧总结。

answer.format 可为 structured（引用编号已校验）、zhida_text（知乎直答普通文本，无逐条引用）或 source_excerpts（检索原始摘要）。普通文本的 evidence 为 unverified，相关检索资料不能当作正文证据。ZHIHU_GENERATION_MODE=sources 可在额度不足时完全跳过生成调用。

## 检索质量信息

新回答可包含 `search_info`：`strategy` 为 semantic/basic/fallback，`candidate_count` 为去重后的候选数，`selected_count` 为最终展示数，`reviewed` 表示完成过模型筛选，`expanded` 表示使用过备用查询。`queries` 记录真正执行的查询，最多 3 条。结果最多展示 5 篇，数量少于 5 不表示请求失败。

筛选后的 Source 可包含 `relevance={reason,evidence,caveat?,match_level?}`。reason 是 AI 的相关性解释，evidence 必须为该来源标题或摘要中的连续原文，caveat 提醒尚未确认的条件；这些字段不增加事实证据。原始 `excerpt`、作者、链接不改写，页面优先展示 evidence 附近的原始摘要片段。编号在筛选后重新连续分配，再传给回答生成器。旧答案缺少这些可选字段仍可读取。

Source 可选 `comment_count`（评论数）、`vote_up_count`（赞同数），来自知乎响应的 `CommentCount` / `VoteUpCount`。非负安全整数才保留，0 是有效值，缺失/null/非法数值留空，不由模型估算。`updated_at` 来自 `EditTime`，不保证为首次发布时间。评论、赞同与更新日期会在卡片及文字回复展示；仅在相关性和条件匹配度相同的层级内用于综合排序。排序完成后再截取最多 5 篇和分配引用编号。

规划/筛选失败时 `strategy=fallback`，在页面和文字回复中提示候选资料仍需核对。筛选成功时，只有通过筛选的帖子进入生成；筛选后无相关内容则返回资料不足，不用被淘汰的帖子填充。模型不可用时保留候选资料并明确降级状态。模型推理期间修改条件会取消旧任务后续步骤。回答接口与文字入口的执行预算为 300 秒。
