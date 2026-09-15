export async function readGenerationStream<T>(response: Response, progress: (percent: number, label: string) => void): Promise<T> {
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) return response.json();
  if (!response.body) throw new Error("未收到生成结果，请重新生成。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: T | undefined;
  let percent = 0;
  function consume(line: string) {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "error") throw new Error(event.error || "生成失败，请重新生成。");
    if (event.type === "progress" && Number.isFinite(event.percent) && typeof event.label === "string") {
      percent = Math.max(percent, Math.min(100, Math.max(0, event.percent)));
      progress(percent, event.label);
    }
    if (event.type === "result") result = event.result;
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) consume(line);
      if (done) { consume(buffer); break; }
    }
    if (!result) throw new Error("生成连接提前结束，请重新生成。");
    return result;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
