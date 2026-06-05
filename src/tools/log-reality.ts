import { ingestReality } from "../reality.js";
import { updateTaskStatus } from "../intent.js";
import { readTasks, writeTasks } from "../storage.js";

const rawText = process.argv[2];

if (!rawText || rawText.trim().length === 0) {
  process.stderr.write("usage: bun run src/tools/log-reality.ts \"raw message text\"\n");
  process.exit(1);
}

const tasks = readTasks();
const { closedTaskId } = await ingestReality(rawText.trim(), tasks);

if (closedTaskId !== undefined) {
  try {
    const updatedTasks = updateTaskStatus(closedTaskId, "done", tasks);
    writeTasks(updatedTasks);
  } catch {
    // Task may already be in a terminal status; not fatal.
  }
}

let out = `logged: ${rawText.trim()}`;

if (closedTaskId !== undefined) {
  const allTasks = readTasks();
  const closed = allTasks.find((t) => t.id === closedTaskId);
  if (closed !== undefined) {
    out += ` [closed task: ${closed.title}]`;
  }
}

process.stdout.write(out + "\n");
