import type { ReadingQuestion } from "./reading-intent";

/** Original teaching examples. These are not Zhihu posts, authors, rankings or statistics. */
export type DemoSearchItem = {
  Title: string; ContentType: string; ContentID: string; ContentText: string; Url: string;
  AuthorName: string; AuthorBadgeText: string; VoteUpCount: number; CommentCount: number; EditTime: number;
};
export type DemoTopic = {
  id: string; title: string; summary: string; keywords: string[];
  sources: DemoSearchItem[]; questions: Array<{ prompt: string; choices: string[] }>;
};

const source = (id: string, title: string, text: string): DemoSearchItem => ({
  Title: `[示例] ${title}`, ContentID: id, ContentType: "Answer", ContentText: `【探山原创演示材料，非知乎内容】${text}`,
  Url: `/demo#${id}`, AuthorName: "探山原创示例", AuthorBadgeText: "演示材料，非知乎用户",
  VoteUpCount: 0, CommentCount: 0, EditTime: 0,
});

export const DEMO_TOPICS: DemoTopic[] = [
  {
    id: "demo-camera", title: "[示例] 第一台相机如何按拍摄场景选择？",
    summary: "原创示例：从拍摄场景、携带体验、镜头与预算边界出发，练习比较不同选择。",
    keywords: ["相机", "摄影", "拍摄", "镜头", "camera"],
    sources: [
      source("demo-camera-1", "先用拍摄清单定义第一台相机", "挑选第一台相机前，先列出最近真正拍过的三种场景，以及手机在哪些地方让自己不满意。静物、日常记录与运动抓拍，对操作、焦段和对焦的要求不同。把需求写成可观察的问题，比先比较参数更容易缩小范围。本文只给出选择方法，不推荐具体型号。"),
      source("demo-camera-2", "携带意愿也是器材需求", "画质之外，要在门店实际握持相机，并把镜头重量一起考虑。一个可以随身携带的组合，可能更适合持续练习；愿意为特定拍摄任务携带器材的人，也可能接受更大的组合。这里没有适合所有人的体积答案，需要结合自己的出行习惯。"),
      source("demo-camera-3", "给机身、镜头与练习留出空间", "预算需要覆盖机身、镜头和必要配件，不能只看机身价格。先明确主要场景需要的焦段，再比较能否用一支镜头开始练习。可先借用或租用，记录不方便的环节，再决定哪些能力值得购买。示例没有提供市场报价或保值承诺。"),
      source("demo-camera-4", "用同一场景比较选择", "确定候选后，用同一个拍摄任务试操作，并观察是否能顺利完成对焦、曝光调整和照片导出。把试用结果与最初的拍摄清单逐项核对。若当前手机已经满足清单，也可以先练习构图与光线，再判断是否需要购置相机。"),
    ],
    questions: [
      { prompt: "你目前使用相机的经历更接近哪种？", choices: ["主要用手机，还没用过相机", "用过相机，正在熟悉操作", "已持续拍摄，想补足具体限制"] },
      { prompt: "你更想先看哪一种拍摄场景的选择思路？", choices: ["日常与旅行记录", "人像或静物创作", "运动与动态抓拍"] },
      { prompt: "比较第一台相机时，你想优先弄清哪个取舍？", choices: ["携带重量与使用意愿", "镜头搭配与整体预算", "操作体验与练习路径"] },
    ],
  },
  {
    id: "demo-ai-study", title: "[示例] 如何把 AI 工具用进自己的学习流程？",
    summary: "原创示例：比较理解概念、自测与资料核验的学习用法，保留独立思考与检验步骤。",
    keywords: ["ai", "人工智能", "学习", "提示词", "自测"],
    sources: [
      source("demo-ai-study-1", "从一项具体学习任务开始", "先选一项可检查的任务，例如解释一个概念或整理一节课的疑问，而不是要求 AI 帮自己学会整门课。先独立尝试，再记录卡住的地方，把背景与问题交给工具。完成后用自己的话复述，观察是否真的理解。"),
      source("demo-ai-study-2", "把解释变成可验证的练习", "AI 给出解释后，可以请它围绕同一概念提出小练习，先自己作答再对照反馈。对答案有疑问时回到教材或可信资料核对。工具生成的问题与答案也可能出错，不能把一次顺利对话直接当成掌握知识的证据。"),
      source("demo-ai-study-3", "给资料核验留一个独立步骤", "将生成内容中的事实主张与解释分开记录。涉及出处、日期、公式和具体数字时，回到原始资料检查，不把看起来完整的引用直接当成已验证来源。找不到依据的部分先标记待核实，再决定是否放入笔记。"),
      source("demo-ai-study-4", "用脱离工具的复述检查掌握", "结束一轮学习后，暂时关闭对话，尝试复述关键概念并完成一道新题。把不会的部分带回下一轮学习，而不是无限延长提问。需要独立完成的作业应遵守课程要求；这份示例不声称 AI 会提高所有人的学习成绩。"),
    ],
    questions: [
      { prompt: "你希望 AI 先帮助哪一项学习任务？", choices: ["理解教材里的概念", "练习与检查知识掌握", "整理资料并核验来源"] },
      { prompt: "你现在的学习流程最常卡在哪一步？", choices: ["独立尝试后仍难以理解", "看懂解释但不会独立应用", "难以判断生成内容是否可靠"] },
      { prompt: "读完材料后，你想优先尝试哪种检查方式？", choices: ["关掉工具后用自己的话复述", "做一道不同条件的练习题", "逐条核对来源与事实主张"] },
    ],
  },
  {
    id: "demo-career", title: "[示例] 转岗前如何用小项目验证职业方向？",
    summary: "原创示例：把转岗愿望拆成任务体验、反馈与复盘，练习判断信息缺口。",
    keywords: ["转岗", "转行", "职业", "工作", "小项目", "career"],
    sources: [
      source("demo-career-1", "先区分岗位名称与日常任务", "转岗前先列出目标岗位的常见任务，并区分自己是喜欢岗位印象还是愿意持续做这些任务。可以阅读公开岗位说明，再向了解该岗位的人核实工作过程。单个岗位说明不能代表整个行业，仍要记录不确定的地方。"),
      source("demo-career-2", "设计一个能完成的小项目", "从目标岗位的一项具体任务出发，设计一个有明确交付物的小项目，例如整理公开资料、写一份分析或制作简单原型。先确定完成标准与可投入的时间，再开始实践。小项目用于了解任务体验，不能代替完整工作经历。"),
      source("demo-career-3", "用具体交付物获得反馈", "反馈时展示项目目标、过程和交付物，询问哪些部分接近真实工作，哪些判断缺乏依据。比起只问自己适不适合，具体材料更容易引出可行动的建议。不同人的经历可能不同，反馈应与项目表现一起看。"),
      source("demo-career-4", "复盘喜欢、困难与信息缺口", "完成小项目后分别记录愿意继续做的任务、实际遇到的困难和仍不清楚的问题。区分技能尚未熟练与不愿长期承担某类工作。再决定补一次实践、继续了解岗位或调整方向，不把一次项目的成败当成最终结论。"),
    ],
    questions: [
      { prompt: "你目前对目标岗位了解到了哪一步？", choices: ["只有岗位印象，想了解日常任务", "看过岗位要求，还没实践", "做过相关任务，想验证长期意愿"] },
      { prompt: "你更想用小项目验证哪一种疑问？", choices: ["是否愿意持续做这些任务", "目前技能与任务要求的差距", "能否产出可供他人评价的成果"] },
      { prompt: "阅读后你希望先完成什么行动？", choices: ["列出岗位任务与待核实问题", "设计一个可完成的小项目", "为已有交付物寻找具体反馈"] },
    ],
  },
];

export function getDemoTopic(idOrTitle: string): DemoTopic | undefined {
  return DEMO_TOPICS.find(topic => topic.id === idOrTitle || topic.title === idOrTitle);
}

/** Search only this finite sample collection. An unrelated query honestly returns no results. */
export function searchDemoTopics(query: string): DemoTopic[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const exact = getDemoTopic(query.trim());
  if (exact) return [exact];
  return DEMO_TOPICS.filter(topic => topic.keywords.some(keyword => {
    if (!/^[a-z0-9_]+$/i.test(keyword)) return normalized.includes(keyword);
    // English keywords are tokens: AI工具 matches, retail / daily / AI_工具 do not.
    return new RegExp(`(^|[^a-z0-9_])${keyword}($|[^a-z0-9_])`, "i").test(normalized);
  }));
}

export function demoSearchItems(query: string): DemoSearchItem[] {
  return searchDemoTopics(query).flatMap(topic => topic.sources.map(item => ({ ...item })));
}

export function getDemoSource(contentId: string): DemoSearchItem | undefined {
  return DEMO_TOPICS.flatMap(topic => topic.sources).find(source => source.ContentID === contentId);
}

export function demoClarification(topic: DemoTopic, turn: number): ReadingQuestion {
  const question = topic.questions[turn];
  if (!question) throw new Error("INVALID_HISTORY");
  return {
    prompt: `[示例追问] ${question.prompt}`, hint: "未配置 AI 时使用示例追问；你的选择将作为阅读路线的需求记录。",
    options: question.choices.map((label, index) => ({ id: `O${index + 1}`, label, detail: `优先关注与“${label}”有关的示例材料。` })),
  };
}

export function demoReadingMap(topic: DemoTopic) {
  return {
    demo: true, generation: "preset", summary: "未配置 AI，展示固定示例路线：先明确问题，再比较约束、实践和核验方法。路线未根据回答重新生成。",
    searchHashIds: [] as string[],
    categories: topic.sources.map((item, index) => ({
      id: `C${index + 1}`, title: item.Title, summary: "原创演示材料，不是实时知乎检索结果。", reason: "此为固定示例顺序，展示阅读地图的基本结构。",
      views: ["区分示例中的方法与待验证的结论"], phase: ["明确任务", "比较选择", "实践核验", "回顾行动"][index],
      posts: [{
        contentId: item.ContentID, title: item.Title, author: item.AuthorName, authorBadge: item.AuthorBadgeText,
        excerpt: item.ContentText, url: item.Url, contentType: item.ContentType, voteUpCount: 0, commentCount: 0, editTime: 0,
        readTime: "约 2 分钟", recommendationReason: "用于演示阅读路线，未按热度排序。", focus: "原创示例",
      }],
    })),
  };
}
