# 问山 Wenshan

多问一句，答案更近一步。

基于 [PRD](docs/PRD.md) 的可运行 MVP 框架：围绕大学问题，通过最多两轮澄清确认目的，再组织检索与回答。前后端在同一个 Next.js 项目中。

## 本次交付范围

- 首页、三个示例问题、目的卡片、专业/关注点补充、跳过、确认、条件修改、答案、来源和反馈页面。
- 服务端模板澄清，严格限制最多两轮/每卡最多两个字段/最多两个关注点。
- PRD 的六组应用接口、匿名 HttpOnly Cookie、SQLite 持久会话、24 小时过期清理。
- 请求幂等、并发生成限制、条件版本隔离、旧答案保留、刷新后读取当前任务；进程重启后明确标记中断，不自动重放生成。
- 知乎 HTTP 搜索/直答适配器、1–2 个初始查询/至多一次简化/最多 3 个查询、链接去重、引用编号校验、安全纯文本渲染。
- 无凭证也可运行的演示模式；不捏造知乎来源或学校事实。

**这是 M1 交互闭环与 M2/M3 的工程基础，不是已通过真实 API 验收的上线产品。** 当前澄清采用模板；真实检索质量、模型引用忠实度、公网部署尚待验证。详见 [验收记录](docs/ACCEPTANCE.md)。

## 本地启动

使用 **Node.js 24 LTS**（会话层使用内置 `node:sqlite`，无需额外数据库安装）。

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

打开 http://localhost:3000 。默认 `WENSHAN_PROVIDER=demo`，没有外部付费请求。页面会明确标注演示模式，回答展示一般性了解框架。

示例操作：输入「如何评价中山大学」→ 本科报考 → 计算机、就业发展/学习体验 → 开始分析 → 修改条件再问。

## 接入知乎

在本机编辑 `.env.local`，将以下配置填好后重启：

```dotenv
WENSHAN_PROVIDER=live
ZHIHU_ACCESS_SECRET=填入自己的凭证
ZHIHU_ANSWER_MODEL=zhida-thinking-1p5
ZHIHU_TIMEOUT_MS=120000
```

凭证只在服务端读取，不能添加 `NEXT_PUBLIC_` 前缀。不要提交 `.env.local`。已有演示会话固定使用原模式，切换配置后请「开启新提问」。未配置 live 凭证时返回明确错误，不静默切换为演示结果。

适配层依据用户提供的知乎 Skill 0.5.3-beta.20260904115023 中 HTTP 文档实现（文档标注核验时间 2026-07-16）。该版本文档的模型、权限和响应需要通过账号联调确认。工程不依赖安装知乎 CLI。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 开发服务器 |
| `npm run check` | ESLint、TypeScript、受控测试 |
| `npm run build` | 生产构建 |
| `npm start` | 生产服务器 |
| `npm run test:smoke` | 对运行中的本地服务器执行 HTTP 主流程验收 |

## 目录

```text
src/
  app/                    # App Router 页面和 HTTP 路由
    api/sessions/         # 创建、恢复、澄清、修改、生成、反馈
  components/             # 工作台、条件表单、答案和来源卡片
  lib/
    domain/               # 类型、输入约束、规则澄清、查询构造
    server/               # SQLite、匿名身份、会话编排、知乎适配器
tests/                    # 规则、并发、幂等、引用、异常的受控测试
scripts/                  # HTTP smoke 脚本
docs/                     # PRD、架构、接口、验收与演示脚本
```

扩展模型时实现 `KnowledgeProvider`；扩展存储时替换 `server/store.ts` 并保留事务、版本校验和请求唯一性。MVP 不引入多个 Agent、OAuth 或长期画像。

## 部署

采用**单个 Node.js 实例 + 持久磁盘**。SQLite/WAL、会话和后台请求依赖长驻进程，当前框架不适合直接使用临时磁盘的 Serverless 或多个副本。需要多实例时，先迁移至共享数据库和持久任务队列。

```sh
docker build -t wenshan-agent .
docker run -d --name wenshan -p 3000:3000 --env-file .env.local -v wenshan-data:/app/.data wenshan-agent
```

生产访问应在 HTTPS 反向代理后运行，匿名 Cookie 在生产模式使用 `Secure`。保持原始 Host/协议正确转发。生成接口会快速返回 202，浏览器通过 GET 读取阶段与结果；不使用长连接流式输出。生成请求上限可配置，默认 120 秒，单次查询上限 20 秒。

依赖与构建过程参照 [Next.js 官方安装文档](https://nextjs.org/docs/app/getting-started/installation)。项目锁定的实际版本以 `package-lock.json` 为准。
