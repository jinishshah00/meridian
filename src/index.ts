import { route } from "./router.js";
import { readTasks } from "./storage.js";
import { execute } from "./execute.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const dryRun = process.env["DRY_RUN"] === "1";

async function processMessage(rawText: string): Promise<void> {
  const tasks = readTasks();
  const routeResult = route(rawText, tasks);
  const execResult = await execute(routeResult, rawText, { dryRun });

  let output = `→ ${execResult.action}`;
  if (execResult.warning !== undefined) {
    output += `\n  ⚠  ${execResult.warning}`;
  }
  console.log(output);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const singleArg = process.argv[2];

if (singleArg !== undefined && singleArg.trim().length > 0) {
  // Single-shot mode: bun run src/index.ts "message"
  await processMessage(singleArg.trim());
} else {
  // Interactive mode: read from stdin line-by-line until Ctrl+C / EOF
  console.log("assistant ready");

  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder();
  let buf = "";

  outer: while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;

    buf += decoder.decode(chunk.value, { stream: true });
    const lines = buf.split("\n");
    // Keep the last (potentially incomplete) fragment in the buffer
    buf = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      if (trimmed === "/quit" || trimmed === "/exit") break outer;
      await processMessage(trimmed);
    }
  }

  // Process any remaining buffered text without a trailing newline
  if (buf.trim().length > 0) {
    await processMessage(buf.trim());
  }
}
