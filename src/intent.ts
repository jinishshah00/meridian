import { randomUUID } from "crypto";
import type { Task, TaskStatus } from "./types.js";

// ─── Status transition table ──────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  todo: ["scheduled", "done", "dropped", "skipped"],
  scheduled: ["todo", "done", "dropped", "skipped"],
  skipped: ["todo", "scheduled", "dropped"],
  done: [],
  dropped: [],
};

// ─── Normalisation helpers ────────────────────────────────────────────────────

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trigrams(text: string): Set<string> {
  const result = new Set<string>();
  if (text.length < 3) return result;
  for (let i = 0; i <= text.length - 3; i++) {
    result.add(text.slice(i, i + 3));
  }
  return result;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return intersection / union;
}

// ─── parseTaskFields ──────────────────────────────────────────────────────────

const RECURRENCE_MAP: Array<[RegExp, string]> = [
  [/\bevery\s+monday\b/i, "RRULE:FREQ=WEEKLY;BYDAY=MO"],
  [/\bevery\s+tuesday\b/i, "RRULE:FREQ=WEEKLY;BYDAY=TU"],
  [/\bevery\s+wednesday\b/i, "RRULE:FREQ=WEEKLY;BYDAY=WE"],
  [/\bevery\s+thursday\b/i, "RRULE:FREQ=WEEKLY;BYDAY=TH"],
  [/\bevery\s+friday\b/i, "RRULE:FREQ=WEEKLY;BYDAY=FR"],
  [/\bevery\s+saturday\b/i, "RRULE:FREQ=WEEKLY;BYDAY=SA"],
  [/\bevery\s+sunday\b/i, "RRULE:FREQ=WEEKLY;BYDAY=SU"],
  [/\bweekly\b/i, "RRULE:FREQ=WEEKLY"],
  [/\bdaily\b/i, "RRULE:FREQ=DAILY"],
  [/\bevery\s+day\b/i, "RRULE:FREQ=DAILY"],
];

const DURATION_PATTERNS: Array<[RegExp, (m: RegExpMatchArray) => number]> = [
  // "half an hour" must come before "an hour" to avoid "an hour" matching first
  [/\bhalf\s+(?:an?\s+)?hour\b/i, () => 30],
  // "an hour" / "a hour" → 60 minutes
  [/\b(?:an?)\s+hour\b/i, () => 60],
  // "2 hours" / "1.5 hours"
  [/\b(\d+(?:\.\d+)?)\s+hours?\b/i, (m) => Math.round(parseFloat(m[1] ?? "0") * 60)],
  // "30 min" / "45 minutes"
  [/\b(\d+)\s+min(?:utes?)?\b/i, (m) => parseInt(m[1] ?? "0", 10)],
];

/**
 * Parse task fields from a raw natural-language message.
 *
 * Consumed tokens (tags, priority keywords, duration phrases, recurrence
 * phrases) are stripped before the remainder becomes the title so the title
 * contains only the meaningful intent noun phrase.
 */
export function parseTaskFields(rawText: string): Partial<Task> {
  const result: Partial<Task> = {};
  let working = rawText;

  // ── Tags ─────────────────────────────────────────────────────────────────────
  const tagMatches = [...working.matchAll(/#(\w+)/g)];
  if (tagMatches.length > 0) {
    result.tags = tagMatches.map((m) => m[1] as string);
    working = working.replace(/#\w+/g, "");
  }

  // ── Recurrence ───────────────────────────────────────────────────────────────
  for (const [pattern, rrule] of RECURRENCE_MAP) {
    if (pattern.test(working)) {
      result.recurrenceRule = rrule;
      working = working.replace(pattern, "");
      break;
    }
  }

  // ── Duration ─────────────────────────────────────────────────────────────────
  for (const [pattern, extract] of DURATION_PATTERNS) {
    const m = working.match(pattern);
    if (m != null) {
      result.estimatedMinutes = extract(m);
      working = working.replace(pattern, "");
      break;
    }
  }

  // ── Priority ─────────────────────────────────────────────────────────────────
  const highPriorityPattern = /\b(urgent|critical|high\s+priority|asap|important)\b/i;
  const lowPriorityPattern = /\b(low\s+priority|whenever|no\s+rush|not\s+urgent)\b/i;

  if (highPriorityPattern.test(working)) {
    result.priority = 1;
    working = working.replace(highPriorityPattern, "");
  } else if (lowPriorityPattern.test(working)) {
    result.priority = 3;
    working = working.replace(lowPriorityPattern, "");
  }

  // ── Title ─────────────────────────────────────────────────────────────────────
  // Collapse leftover whitespace and punctuation-only residue
  const title = working.replace(/\s+/g, " ").trim().replace(/^[,.\-\s]+|[,.\-\s]+$/g, "").trim();
  if (title.length > 0) {
    result.title = title;
  }

  return result;
}

// ─── createTask ───────────────────────────────────────────────────────────────

/**
 * Create a new Task from a raw message. Returns the created Task but does NOT
 * write to disk — the caller is responsible for persisting via writeTasks().
 */
export function createTask(rawText: string, overrides?: Partial<Task>): Task {
  const parsed = parseTaskFields(rawText);

  const base: Task = {
    id: randomUUID(),
    title: parsed.title ?? rawText.trim(),
    status: "todo",
    priority: parsed.priority ?? 2,
    tags: parsed.tags ?? [],
    source: rawText,
    createdAt: new Date().toISOString(),
    ...(parsed.estimatedMinutes !== undefined
      ? { estimatedMinutes: parsed.estimatedMinutes }
      : {}),
    ...(parsed.recurrenceRule !== undefined
      ? { recurrenceRule: parsed.recurrenceRule }
      : {}),
  };

  return { ...base, ...overrides };
}

// ─── updateTaskStatus ─────────────────────────────────────────────────────────

/**
 * Transition a task to a new status.
 *
 * Throws a descriptive Error when the transition is not in the allowed table.
 * Returns a new tasks array — the original is not mutated.
 */
export function updateTaskStatus(
  taskId: string,
  newStatus: TaskStatus,
  tasks: Task[]
): Task[] {
  const taskIndex = tasks.findIndex((t) => t.id === taskId);
  if (taskIndex === -1) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const task = tasks[taskIndex] as Task;
  const allowed = ALLOWED_TRANSITIONS[task.status];

  if (!allowed.includes(newStatus)) {
    throw new Error(
      `Invalid status transition: ${task.status} → ${newStatus}. Allowed from ${task.status}: [${allowed.join(", ") || "none — terminal status"}]`
    );
  }

  const updated: Task = {
    ...task,
    status: newStatus,
    // Stamp timestamp fields based on the new status
    ...(newStatus === "done" ? { completedAt: new Date().toISOString() } : {}),
    ...(newStatus === "skipped" ? { skippedAt: new Date().toISOString() } : {}),
  };

  return tasks.map((t) => (t.id === taskId ? updated : t));
}

// ─── getTasks ─────────────────────────────────────────────────────────────────

/**
 * Return tasks matching the given filter.
 *
 * Default behaviour (no filter) returns all non-done, non-dropped tasks —
 * the active working backlog.
 */
export function getTasks(
  tasks: Task[],
  filter?: { status?: TaskStatus | TaskStatus[]; tags?: string[] }
): Task[] {
  let result = tasks;

  if (filter?.status !== undefined) {
    const statusFilter = Array.isArray(filter.status)
      ? filter.status
      : [filter.status];
    result = result.filter((t) => statusFilter.includes(t.status));
  } else {
    // Default: active backlog — exclude terminal statuses
    result = result.filter((t) => t.status !== "done" && t.status !== "dropped");
  }

  if (filter?.tags !== undefined && filter.tags.length > 0) {
    result = result.filter((t) =>
      (filter.tags as string[]).every((tag) => t.tags.includes(tag))
    );
  }

  return result;
}

// ─── getSkippedQueue ──────────────────────────────────────────────────────────

/**
 * Return all skipped tasks sorted oldest-skippedAt first for the review queue.
 */
export function getSkippedQueue(tasks: Task[]): Task[] {
  return tasks
    .filter((t) => t.status === "skipped")
    .sort((a, b) => {
      // Tasks with no skippedAt sort after tasks that have one
      if (a.skippedAt === undefined && b.skippedAt === undefined) return 0;
      if (a.skippedAt === undefined) return 1;
      if (b.skippedAt === undefined) return -1;
      return a.skippedAt < b.skippedAt ? -1 : a.skippedAt > b.skippedAt ? 1 : 0;
    });
}

// ─── scheduleTask ─────────────────────────────────────────────────────────────

/**
 * Transition a task to 'scheduled' and record when it is scheduled for.
 * Returns the updated tasks array.
 */
export function scheduleTask(
  taskId: string,
  scheduledAt: Date,
  tasks: Task[]
): Task[] {
  const afterTransition = updateTaskStatus(taskId, "scheduled", tasks);
  return afterTransition.map((t) =>
    t.id === taskId ? { ...t, scheduledAt: scheduledAt.toISOString() } : t
  );
}

// ─── dropTask ─────────────────────────────────────────────────────────────────

/**
 * Drop a task (status → 'dropped'). Returns the updated tasks array.
 */
export function dropTask(taskId: string, tasks: Task[]): Task[] {
  return updateTaskStatus(taskId, "dropped", tasks);
}

// ─── findDuplicates ───────────────────────────────────────────────────────────

const DUPLICATE_THRESHOLD = 0.8;

/**
 * Detect likely duplicate captures using trigram Jaccard similarity.
 *
 * Both strings are normalised (lowercase, punctuation stripped, whitespace
 * collapsed) before comparison. Tasks with status 'done' or 'dropped' are
 * excluded — closed tasks cannot be duplicates.
 *
 * Returns tasks whose title similarity to rawText is ≥ 0.8.
 */
export function findDuplicates(rawText: string, tasks: Task[]): Task[] {
  const normalisedInput = normalise(rawText);
  const inputTrigrams = trigrams(normalisedInput);

  return tasks.filter((task) => {
    if (task.status === "done" || task.status === "dropped") return false;
    const normalisedTitle = normalise(task.title);
    const taskTrigrams = trigrams(normalisedTitle);
    const similarity = jaccardSimilarity(inputTrigrams, taskTrigrams);
    return similarity >= DUPLICATE_THRESHOLD;
  });
}
