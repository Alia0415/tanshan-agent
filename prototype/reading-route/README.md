# 阅读路线原型（standalone）

本目录是**独立的原型工程**，验证「问题页 → 澄清 3 问 → 生成 1→2→3→4 阅读路线」这条链路，
对应 [落地实施与四人分工 v0.3](../../docs/) 中的 `feat/ui-reading-map` 方向。

它与仓库主体（`src/` 下的通用问答 Agent 框架）**不是同一份代码**，两者暂不共享模块：

| | 本原型 | 仓库主体 |
|---|---|---|
| 产品形态 | 问题页个性化阅读路线 | 站内对话式问答 Agent |
| 源码目录 | `app/`、`lib/` | `src/app/`、`src/lib/` |
| 澄清轮次 | 固定 3 问 | 最多 5 轮，可跳过 |
| 产出 | 分类阅读路线 + 每类 4–5 篇内容 | 帖子卡片 + 辅助总结 |

## 为什么放在子目录

Next.js 官方约定：**根目录存在 `app/` 时，`src/app/` 会被整个忽略**。
若把本原型的 `app/` 放到仓库根目录，主体的全部页面与 API 路由会静默失效。
因此原型整体隔离在 `prototype/` 下，并在根 `tsconfig.json` 与 `eslint.config.mjs` 中排除，
既不影响 `npm run check` / `npm run build`，也保留后续整合的余地。

## 本地运行

本目录自带 `package.json`，依赖与主体独立，需单独安装：

```bash
cd prototype/reading-route
npm install
cp .env.example .env.local   # 填入 ZHIHU_ACCESS_SECRET
npm run dev                  # http://localhost:3000
```

`ZHIHU_ACCESS_SECRET` 仅服务端读取，不要加 `NEXT_PUBLIC_` 前缀，不要提交 `.env.local`。

## 状态

原型阶段，接口与数据结构（`lib/reading-intent.ts` 的 `UserIntent` 等）尚未与主体契约对齐。
整合进 `src/` 前需要先确认共享契约，避免两侧重复定义。
