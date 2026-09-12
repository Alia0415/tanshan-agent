# 应用 HTTP 接口

这是问山自己的协议，不是知乎原生 API。所有写请求均使用 `Content-Type: application/json`，浏览器同源访问，携带自动设置的 `wenshan_browser` HttpOnly Cookie。ID 不能单独作为访问凭证。响应不缓存。

| 方法与路径                              | 请求                                               | 响应                                           |
| --------------------------------------- | -------------------------------------------------- | ---------------------------------------------- |
| `POST /api/sessions`                    | `{question}`                                       | 201 `{session, auto_answer}` 并设置匿名 Cookie |
| `GET /api/sessions/:id`                 | 无                                                 | 200 `{session}`                                |
| `POST /api/sessions/:id/clarifications` | `{context_version, selections, free_text?, skip?}` | 200 `{session, auto_answer}`                   |
| `PATCH /api/sessions/:id/context`       | `{context_version, changes, free_text?}`           | 200 `{session}`，新版本 ready                  |
| `POST /api/sessions/:id/answer`         | `{context_version, request_id}`                    | 202 `{session}`，通过 GET 查询进度             |
| `POST /api/sessions/:id/feedback`       | `{answer_id, type, reason?}`                       | 200 `{received:true}`                          |

`question` 去除首尾空白后 1–2000 字符，单个补充最多 2000 字符，会话补充累计最多 8000 字符。关注点最多两项，字段选择只允许当前卡片提供的字段。`changes` 可编辑所有条件字段，传 `null` 清除可选字段。`purpose`：`understand`、`decide`、`solve`、`overview`；`priorities` 为字符串数组。

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

返回 session_id、context_version、stage、text、provider，以及可选 clarification 和 answer。宽泛问题返回追问；清晰问题或完成补充后自动生成。对目的卡片可直接回复自然语言，也可回复选项全文或 1–4；不强制结构化表单。

本接口等待处理完成，当前没有流式输出。发生断线时先 GET /api/sessions/:id 检查是否仍在生成。后续消息携带旧版本会返回 409；首次消息创建暂不提供宿主事件级幂等。不要将此调试协议直接注册为未经确认的知乎 webhook。

错误 SESSION_VERSION（410）表示旧版大学演示会话，需要新建，不会自动迁移或覆盖原记录。
