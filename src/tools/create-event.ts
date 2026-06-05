import { createCalendarEvent } from "../plan.js";

const arg = process.argv[2];

if (!arg || arg.trim().length === 0) {
  process.stderr.write(
    "usage: bun run src/tools/create-event.ts '{\"title\":\"...\",\"startAt\":\"...\",\"endAt\":\"...\",\"tier\":1}'\n"
  );
  process.exit(1);
}

function parseArg(raw: string): { title: string; startAt: string; endAt: string; tier: 1 | 2 } | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }

  if (obj === null || typeof obj !== "object") return null;

  const { title, startAt, endAt, tier } = obj as Record<string, unknown>;

  if (
    typeof title !== "string" ||
    typeof startAt !== "string" ||
    typeof endAt !== "string" ||
    (tier !== 1 && tier !== 2)
  ) {
    return null;
  }

  return { title, startAt, endAt, tier: tier as 1 | 2 };
}

const input = parseArg(arg);

if (input === null) {
  process.stderr.write("error: required fields: title (string), startAt (ISO string), endAt (ISO string), tier (1|2)\n");
  process.exit(1);
}

// Non-null assertion: the process.exit(1) above guarantees input is defined here.
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const { title, startAt: startAtStr, endAt: endAtStr, tier } = input!;
const startAt = new Date(startAtStr);
const endAt = new Date(endAtStr);

if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) {
  process.stderr.write("error: startAt and endAt must be valid ISO date strings\n");
  process.exit(1);
}

try {
  const entry = await createCalendarEvent({ title, startAt, endAt, tier });
  process.stdout.write(`event created: ${entry.title} — ${entry.startAt}\n`);
} catch (err) {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
