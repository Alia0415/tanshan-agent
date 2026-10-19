import Link from "next/link";
import { DEMO_TOPICS } from "@/lib/reading/demo";
import { isPublicDemo } from "@/lib/server/public-demo";
import styles from "./page.module.css";

export const metadata = { title: "在线体验 · 探山 Tanshan" };

export default function DemoPage() {
  const demo = isPublicDemo();
  const ai = demo && Boolean(process.env.DEEPSEEK_API_KEY?.trim());
  return <main className={styles.page}>
    <p className={styles.eyebrow}>TANSHAN · ONLINE EXPERIENCE</p>
    <h1>从一个问题，体验三种探索方式。</h1>
    <p className={styles.lead}>{demo ? (ai ? "DeepSeek 提供 AI 追问、资料整理与观点讨论，阅读材料来自预置样例库。" : "当前展示样例与本地规则。部署时配置 DeepSeek 密钥，即可启用 AI 生成。") : "这里展示在线体验使用的原创示例材料。当前服务未启用公开样例模式。"}</p>
    <aside className={styles.notice}>以下为探山原创教学样例，包含虚拟情境，均非真实知乎帖子或实时热榜。AI 整理也需要核对适用条件。体验模式关闭知乎登录，不读取知乎账号内容。</aside>
    <div className={styles.features}>
      <Link href="/"><strong>Agent 问答 →</strong><span>补充处境，整理思路</span></Link>
      <Link href="/reading"><strong>阅读助手 →</strong><span>按关注点探索示例材料</span></Link>
      <Link href="/roundtable"><strong>观点圆桌 →</strong><span>比较不同立场与取舍</span></Link>
    </div>
    <h2>选择一个示例主题</h2>
    {DEMO_TOPICS.map(topic => <section key={topic.id} id={topic.id} className={styles.topic}>
      <h3>{topic.title}</h3><p>{topic.summary}</p>
      <div className={styles.actions}><Link href={{ pathname: "/", query: { q: topic.title } }}>用问答探索 →</Link><Link href={`/reading/question/${topic.id}`}>生成阅读地图 →</Link><Link href={{ pathname: "/roundtable", query: { q: topic.title } }}>进入圆桌 →</Link></div>
      <details><summary>查看 {topic.sources.length} 篇原创示例材料</summary>{topic.sources.map(source => <article id={source.ContentID} key={source.ContentID} className={styles.source}><h4>{source.Title}</h4><p>{source.ContentText}</p><small>{source.AuthorName} · 原创演示材料</small></article>)}</details>
    </section>)}
    <p className={styles.footnote}>样例库暂未覆盖其他主题时，会明确提示材料不足。问答和圆桌会话按浏览器身份隔离；请勿在公开体验中输入敏感信息。</p>
  </main>;
}
