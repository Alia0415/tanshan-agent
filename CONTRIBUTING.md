# 参与贡献

欢迎改进探山的交互、检索质量、阅读体验与讨论表现。开始前请阅读 [项目首页](README.md)、[当前范围](docs/AGENT_SCOPE.md) 和 [本地运行指南](docs/GETTING_STARTED.md)。

## 本地开发

使用 Node.js 24+，在仓库根目录运行 `npm ci`。无密钥开发可设置 `WENSHAN_PUBLIC_DEMO=1`，并保持 `DEEPSEEK_API_KEY` 为空，使用三个模块的本地脚本样例。

根目录是主应用入口；`prototype/` 是历史原型。代码分工与会话流程见 [工程架构](docs/ARCHITECTURE.md)，配置行为见 [配置详解](docs/CONFIGURATION.md)。

## 修改约定

- 保持 Agent 问答、阅读助手和观点圆桌的独立入口；跨模块可以携带主题，由用户确认后提交。
- 产品文案使用“探山 / Tanshan”。现有 `WENSHAN_*` 配置、数据库路径及存储标识继续兼容，品牌调整不应顺带迁移运行数据。
- 让帖子来源、搜索摘要和模型生成内容保持可辨识；失败、降级与缺少引用时给出真实状态。
- 行为变更同步更新相关文档，并为有实际回归风险的逻辑补充受控测试。不要用当前 API 响应或历史演示结果替代稳定断言。
- 不提交 `.env.local`、填入真实值的部署配置或 `.data` 运行数据。需要新增配置时更新 `.env.example` 并说明默认行为。

## 验证改动

代码改动提交前，运行与 CI 一致的检查：

```sh
npm run check
npm run build
```

`check` 包含 ESLint、TypeScript 与受控测试，不调用真实外部模型。页面改动还需在浏览器检查相关流程、窄屏布局与错误状态；三个模块有独立入口，按改动范围分别验收。

仅修改文档或展示素材时，核对相对链接、命令与当前实现是否一致，运行 `git diff --check`，并检查图片和视频能正常打开。

对已启动、关闭 AI 的全站样例服务，可运行 `npm run test:public-demo`。早期问答专用的 `npm run test:smoke` 使用另一套模式配置，具体区别见 [HTTP 验收](docs/GETTING_STARTED.md#对已启动的本地服务做-http-验收)。

真实服务联调由开发者明确选择后手动执行：`npm run test:zhihu`、`npm run test:clarification`、`npm run test:search` 会消耗上游额度，不在 CI 中自动运行。请求范围见 [真实服务联调](docs/GETTING_STARTED.md#真实服务联调)。需要验证真实知乎登录时，单独完成授权流程；受控测试通过不等于线上授权已验证。

## 提交与 PR

围绕一个清晰的问题提交改动，说明触发场景、调整后的行为和验证结果。界面变更附关键截图或短视频；如仍有未验证的真实服务路径，简要列出即可。不要把某次小样本结果写成整体效果指标。

PR 使用仓库的 [模板](.github/PULL_REQUEST_TEMPLATE.md)。文档导航集中在 [docs/README.md](docs/README.md)。
