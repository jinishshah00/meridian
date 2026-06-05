import { createReminder } from "../plan.js";

const arg = process.argv[2];

if (!arg || arg.trim().length === 0) {
  process.stderr.write(
    "usage: bun run src/tools/create-reminder.ts '{\"title\":\"...\",\"dueAt\":\"...\",\"tier\":1}'\n"
  );
  process.exit(1);
}

function parseArg(raw: string): { title: string; dueAt: string; tier: 1 | 2 } | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }

  if (obj === null || typeof obj !== "object") return null;

  const { title, dueAt, tier } = obj as Record<string, unknown>;

  if (
    typeof title !== "string" ||
    typeof dueAt !== "string" ||
    (tier !== 1 && tier !== 2)
  ) {
    return null;
  }

  return { title, dueAt, tier: tier as 1 | 2 };
}

const input = parseArg(arg);

if (input === null) {
  process.stderr.write("error: required fields: title (string), dueAt (ISO string), tier (1|2)\n");
  process.exit(1);
}

// Non-null assertion: the process.exit(1) above guarantees input is defined here.
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const { title, dueAt: dueAtStr, tier } = input!;
const dueAt = new Date(dueAtStr);

if (isNaN(dueAt.getTime())) {
  process.stderr.write("error: dueAt must be a valid ISO date string\n");
  process.exit(1);
}

try {
  const entry = await createReminder({ title, dueAt, tier });
  process.stdout.write(`reminder set: ${entry.title} — ${entry.startAt}\n`);
} catch (err) {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
