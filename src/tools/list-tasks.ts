import { getTasks } from "../intent.js";
import { readTasks } from "../storage.js";
import type { TaskStatus } from "../types.js";

const arg = process.argv[2];

// Valid TaskStatus values for runtime validation
const VALID_STATUSES: TaskStatus[] = ["todo", "scheduled", "skipped", "done", "dropped"];

function parseFilter(raw: string): { status?: TaskStatus | TaskStatus[] } | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }

  if (obj === null || typeof obj !== "object") return null;

  const { status } = obj as Record<string, unknown>;

  if (status === undefined) return {};

  if (typeof status === "string") {
    if (!VALID_STATUSES.includes(status as TaskStatus)) return null;
    return { status: status as TaskStatus };
  }

  if (Array.isArray(status)) {
    for (const s of status as unknown[]) {
      if (!VALID_STATUSES.includes(s as TaskStatus)) return null;
    }
    return { status: status as TaskStatus[] };
  }

  return null;
}

let filter: { status?: TaskStatus | TaskStatus[] } = {};

if (arg && arg.trim().length > 0) {
  const parsed = parseFilter(arg);
  if (parsed === null) {
    process.stderr.write(`error: invalid filter. Status must be one of: ${VALID_STATUSES.join(", ")}\n`);
    process.exit(1);
  } else {
    filter = parsed;
  }
}

const tasks = readTasks();
const result = getTasks(tasks, filter);
process.stdout.write(JSON.stringify(result, null, 2) + "\n");
