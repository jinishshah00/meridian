import { createTask, findDuplicates } from "../intent.js";
import { readTasks, writeTasks } from "../storage.js";

const rawText = process.argv[2];

if (!rawText || rawText.trim().length === 0) {
  process.stderr.write("usage: bun run src/tools/create-task.ts \"raw message text\"\n");
  process.exit(1);
}

const tasks = readTasks();
const task = createTask(rawText.trim());
const duplicates = findDuplicates(task.title, tasks);

writeTasks([...tasks, task]);

let out = `task created: ${task.title}`;
if (duplicates.length > 0) {
  const titles = duplicates.map((d) => `'${d.title}'`).join(", ");
  out += ` [warn: similar task ${titles} exists]`;
}

process.stdout.write(out + "\n");
