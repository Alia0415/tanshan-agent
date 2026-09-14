import React, {type CSSProperties} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {readFileSync,writeFileSync} from "node:fs";
const selectedPostKey="preview",mindMapReplay=0;
const selectedMindMap={thesis:"独居者离世无继承人，房产归国家，亲戚获分部分遗产",branches:[{label:"事件背景",points:["北京独居者离世，无配偶、子女及兄弟姐妹","九名亲属就遗产分配产生争议"]},{label:"判断依据",points:["文章引用法定继承范围及无人继承遗产的相关规定","亲属的照料情况影响部分遗产分配"]},{label:"最终结果",points:["房产归国家，亲属获分部分存款及保险","具体分配及裁判理由需查看原文"]}]};
const html=renderToStaticMarkup(                  <div className="reading-flow" key={selectedPostKey + mindMapReplay}>
                    <div className="reading-flow-thesis">
                      <span>一句话结论</span>
                      <p>{selectedMindMap.thesis}</p>
                    </div>
                    <ol className="reading-flow-steps">
                      {selectedMindMap.branches.map((branch, index) => (
                        <li className="reading-flow-step" style={{ "--step": index } as CSSProperties} key={branch.label + index}>
                          <div className="reading-flow-marker" aria-hidden="true">{String(index + 1).padStart(2, "0")}</div>
                          <article>
                            <h4>{branch.label}</h4>
                            <ul>{branch.points.map((point) => <li key={point}>{point}</li>)}</ul>
                          </article>
                        </li>
                      ))}
                    </ol>
                    <small className="reading-flow-source">基于知乎搜索摘要生成 · 尚未获取全文</small>
                  </div>
);
const css=readFileSync("src/app/reading/reading.css","utf8");
writeFileSync(".preview-reading/index.html",`<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>文章速读 · 动画预览</title><style>${css}body{margin:0;background:#f6f8fb;padding:32px 20px}main{max-width:1080px;margin:auto;background:white;padding:28px;border-radius:16px} .mind-map-heading h3{font-size:24px}@media(max-width:760px){body{padding:12px}main{padding:16px}}</style><main class="reading-scope"><div class="mind-map-heading"><div><span>30 秒看懂</span><h3>文章速读</h3></div><button class="mind-map-replay" onclick="const el=document.querySelector('.reading-flow');el.replaceWith(el.cloneNode(true))">重播动画</button></div>${html}</main></html>`);
