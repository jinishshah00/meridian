import { dropTask } from "../intent.js";
import { readTasks, writeTasks } from "../storage.js";

const rawTitle = process.argv[2];

if (!rawTitle || rawTitle.trim().length === 0) {
  process.stderr.write("usage: bun run src/tools/drop-task.ts \"task title\"\n");
  process.exit(1);
}

const tasks = readTasks();
const target = tasks.find(
  (t) =>
    t.title.toLowerCase().includes(rawTitle.toLowerCase()) &&
    t.status !== "done" &&
    t.status !== "dropped"
);

if (target === undefined) {
  process.stdout.write(`not found: ${rawTitle}\n`);
  process.exit(0);
} else {
  const updated = dropTask(target.id, tasks);
  writeTasks(updated);
  process.stdout.write(`dropped: ${target.title}\n`);
}
