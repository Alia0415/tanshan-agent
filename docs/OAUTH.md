# 知乎 OAuth 接入

作品支持用户使用知乎账号登录，并查看其授权范围内的创作、关注与收藏。授权流程遵循知乎黑客松 OAuth 规范：`app_id` / `app_key` 由活动页面分配，回调地址必须与活动页面登记值完全一致。

## 页面与接口

| 路径 | 说明 |
|---|---|
| `/me` | 「我的知乎」页面：登录入口、授权状态、四类内容展示 |
| `GET /api/oauth/authorize` | 跳转知乎授权页（state 使用访客令牌，回调时校验同一浏览器） |
| `GET /api/oauth/callback` | 接收 `authorization_code`（兼容 `code`），服务端换取 token 后按访客绑定存储 |
| `GET /api/oauth/status` | 配置与登录状态（App Key 只返回是否配置，不返回值） |
| `POST /api/oauth/logout` | 清除本访客的 OAuth 会话 |
| `GET /api/me/contents` | 用户创作（`ContentType` 默认 `all`） |
| `GET /api/me/followees` | 用户关注 |
| `GET /api/me/favlists` | 收藏夹列表 |
| `GET /api/me/favlist?FavlistUrlToken=` | 收藏夹内容（依赖收藏夹列表的 `UrlToken`） |
| `GET /api/me/collections` | 近期收藏 |

用户数据代理统一携带 `Authorization: Bearer <Access Secret>`、`X-OAuth-Token`、`X-Request-Timestamp`，且不自动重试（真实上游调用）。

## 部署清单

1. 队长在活动页面创建项目，取得 `app_id` 与 `app_key`。
2. 部署到公网 HTTPS（如 Cloudflare / Sealos），把 `https://<域名>/api/oauth/callback` 登记到活动页面，注意与登记值逐字符一致。
3. 在部署平台设置 Secret：
   - `ZHIHU_OAUTH_APP_ID`
   - `ZHIHU_OAUTH_APP_KEY`
   - `ZHIHU_OAUTH_REDIRECT_URI`（登记的回调地址）
   - `ZHIHU_ACCESS_SECRET`（开放平台调用凭证，已有）
4. 本地预览无法完成真实登录（回调必须是公网地址）；未配置时 `/me` 会显示配置提示，授权链路其余部分可正常演示。

## 安全边界

- `app_key`、Access Secret、授权码、OAuth token 只在服务端处理；不写入源码、日志、前端响应或 URL。
- OAuth token 按访客 Cookie 绑定存于本地 SQLite，过期自动失效；登出即清除。
- 诊断信息（`/api/oauth/status`）只暴露配置与否，不暴露凭证值。
