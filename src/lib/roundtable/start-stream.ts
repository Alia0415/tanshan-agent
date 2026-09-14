import type { Roundtable } from "./engine";

export type PreviewSource = { id: number; title: string; url: string };
type StartEvent =
  | { type: "progress"; message: string; sources?: PreviewSource[] }
  | { type: "complete"; round: Roundtable }
  | { type: "error"; message: string };

export async function readStartStream(
  response: Response,
  onProgress: (message: string, sources?: PreviewSource[]) => void,
): Promise<Roundtable> {
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error?.message || "请求未完成。");
  }
  if (!response.body) throw new Error("连接已断开，请重试。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split("\n");
      pending = lines.pop() || "";
      if (done && pending.trim()) lines.push(pending);
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as StartEvent;
        if (event.type === "error") throw new Error(event.message);
        if (event.type === "complete") return event.round;
        if (event.type === "progress") onProgress(event.message, event.sources);
      }
      if (done) throw new Error("连接已中断，未收到完整圆桌，请重试。");
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
