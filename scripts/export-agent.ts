import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AGENT_INSTRUCTIONS, AGENT_PROFILE } from "../src/lib/agent/definition";

const directory = resolve(import.meta.dirname, "../agent");
mkdirSync(directory, { recursive: true });
writeFileSync(
  resolve(directory, "SYSTEM_PROMPT.md"),
  `# ${AGENT_PROFILE.name}\n\n${AGENT_INSTRUCTIONS}\n`,
);
writeFileSync(
  resolve(directory, "OPENING.md"),
  `${AGENT_PROFILE.greeting}\n\n${AGENT_PROFILE.suggestedQuestions.map((question) => `- ${question}`).join("\n")}\n`,
);
console.log(
  "Exported agent/SYSTEM_PROMPT.md and agent/OPENING.md (product configuration, not an official platform package).",
);
