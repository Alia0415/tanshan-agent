# 知乎登录与个人中心

基于 tanshan-agent main 6a27f79。接口协议来自官方 zhihu Skill 0.7.2-beta.20260911131715 的 OAuth、黑客松用户资料与用户数据文档；CLI 只查询 Access Secret 本人，网站必须使用当前登录用户的 OAuth Token。

## 使用流程

右上角「知乎登录」进入个人中心，点击「使用知乎登录」跳转知乎授权。授权成功后右上角显示头像与昵称；点击头像进入 /me，展示昵称、头像、签名和个人介绍，下方展示创作摘要和关注，支持加载更多。保留收藏夹与近期收藏入口。

## 线上回调

请在 App ID 529 的平台登记以下完整地址：

https://tanshan-270489-8-1443398117.sh.run.tcloudbase.com/api/oauth/callback

服务器会接受 authorization_code（兼容 code）。保留主分支的根路径回调转发，但线上登记地址必须与实际配置逐字符一致。先前的 http://127.0.0.1/ 只适用于本地服务，不能完成线上用户回调。

## 独立部署配置

公开仓库中的 src/lib/server/zhihu-deployment.ts 仅保存 App ID 和回调地址默认值；App Key 与 Access Secret 在部署平台服务端环境变量中配置。本机可使用被 Git 忽略的 .env.production.local，不需要本机 CLI。Docker 构建排除 .env 文件，独立部署时需要在平台填写下列变量。

部署环境变量：

- ZHIHU_OAUTH_APP_ID（兼容 ZHIHU_APP_ID）
- ZHIHU_OAUTH_APP_KEY（兼容 ZHIHU_APP_KEY）
- ZHIHU_OAUTH_REDIRECT_URI
- ZHIHU_ACCESS_SECRET

已有环境变量可能覆盖默认配置；尤其需要确认回调地址不是旧的本机地址。OAuth access_token 是每个用户授权后动态获得的，存于服务端 SQLite，不使用固定 Token 代替用户身份。

当前部署沿用 SQLite，适用于单实例，并需持久化 WENSHAN_DB_PATH 指定的数据目录。多实例/弹性扩容前必须改用共享数据库会话存储；不要让不同实例各自持有独立 SQLite。

## 协议与会话

- 授权：https://openapi.zhihu.com/authorize
- Token 交换：https://openapi.zhihu.com/access_token
- 用户资料：https://openapi.zhihu.com/user（仅 OAuth Token）
- 创作和关注：https://developer.zhihu.com/api/v1/user/contents、/api/v1/user/followees（Access Secret + X-OAuth-Token + X-Request-Timestamp）
- state 为独立随机值，绑定浏览器，10 分钟有效，数据库原子消费，拒绝缺失、过期、串号与重放。
- 用户资料有效后才建立会话，uid 在 JSON 解析前保护精度；返回前端的资料排除邮箱和手机号。
- 会话有效期以 Token 为准且最长 24 小时。退出或列表接口鉴权失效时清理会话，不回退到应用所有者身份。
- 分页使用服务端 NextOffset，保留 Int64 精度；接口错误与空列表分开显示。

## 验证

自动化测试覆盖授权参数、state、用户隔离、过期、精确 ID、HTTP/业务错误与分页参数。生产构建与浏览器检查由开发过程执行。真实知乎授权必须由用户在正式平台完成；Mock 成功不代表线上授权已通过。

可设置 WENSHAN_BUILD_DIR=.next-oauth-check 单独构建，避免影响已经运行的本地预览。

### 本次验收结果（2026-09-15）

- main 基线：6a27f79，远端核对一致。
- 全量 131 项测试通过；最终 OAuth 7 项回归测试通过。
- ESLint、TypeScript 与生产构建通过。
- Edge 无头浏览器验证桌面 1440px 与手机 390px：资料、头像入口、创作/关注加载更多、限流错误重试、退出。业务响应使用 Mock。
- 实际本地 HTTP 验证授权 URL 和缺失/错误 state 拒绝；此前扫描 27 个客户端构建文件未发现 App Key 或 Access Secret；发布前还会检查 Git 提交内容不包含密钥。
- 未部署到线上、未进行真实知乎授权。需先确认平台登记回调与线上配置一致，再由用户完成授权。
