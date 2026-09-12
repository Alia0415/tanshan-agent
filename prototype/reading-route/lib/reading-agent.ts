import "server-only";
export async function agentJSON(prompt: string): Promise<unknown> {
  const secret = process.env.ZHIHU_ACCESS_SECRET;
  if (!secret) throw new Error("ZHIHU_SECRET_MISSING");
  const response = await fetch("https://developer.zhihu.com/v1/chat/completions", {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(90000),
    headers: { Authorization: `Bearer ${secret}`, "X-Request-Timestamp": String(Math.floor(Date.now() / 1000)), "Content-Type": "application/json" },
    body: JSON.stringify({ model: "zhida-fast-1p5", messages: [{role: "user", content: prompt}], stream: false }),
  });
  if (!response.ok) throw new Error(`ZHIHU_HTTP_${response.status}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("ZHIHU_AGENT_EMPTY");
  const json = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1);
  return JSON.parse(json);
}
