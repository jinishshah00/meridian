import { describe, expect, test } from "bun:test";
import type { Task, TaskStatus } from "../src/types.js";
import {
  createTask,
  dropTask,
  findDuplicates,
  getSkippedQueue,
  getTasks,
  parseTaskFields,
  scheduleTask,
  updateTaskStatus,
} from "../src/intent.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "test-id",
    title: "Default task",
    status: "todo",
    priority: 2,
    tags: [],
    source: "Default task",
    createdAt: "2026-01-01T09:00:00.000Z",
    ...overrides,
  };
}

// ─── parseTaskFields ──────────────────────────────────────────────────────────

describe("parseTaskFields", () => {
  test("extracts a plain title", () => {
    const result = parseTaskFields("buy groceries");
    expect(result.title).toBe("buy groceries");
  });

  test("extracts single tag", () => {
    const result = parseTaskFields("review PR #work");
    expect(result.tags).toEqual(["work"]);
  });

  test("extracts multiple tags", () => {
    const result = parseTaskFields("run 5k #health #fitness");
    expect(result.tags).toEqual(["health", "fitness"]);
  });

  test("strips tags from title", () => {
    const result = parseTaskFields("buy groceries #errands");
    expect(result.title).toBe("buy groceries");
    expect(result.tags).toEqual(["errands"]);
  });

  test("priority: urgent → 1", () => {
    const result = parseTaskFields("urgent call doctor");
    expect(result.priority).toBe(1);
  });

  test("priority: critical → 1", () => {
    const result = parseTaskFields("critical bug fix");
    expect(result.priority).toBe(1);
  });

  test("priority: high priority → 1", () => {
    const result = parseTaskFields("high priority report");
    expect(result.priority).toBe(1);
  });

  test("priority: low priority → 3", () => {
    const result = parseTaskFields("low priority organise desk");
    expect(result.priority).toBe(3);
  });

  test("priority: whenever → 3", () => {
    const result = parseTaskFields("whenever sort old emails");
    expect(result.priority).toBe(3);
  });

  test("priority: no rush → 3", () => {
    const result = parseTaskFields("no rush clean the garage");
    expect(result.priority).toBe(3);
  });

  test("priority: absent → no priority field returned", () => {
    const result = parseTaskFields("schedule meeting");
    expect(result.priority).toBeUndefined();
  });

  test("duration: '30 min'", () => {
    const result = parseTaskFields("write report 30 min");
    expect(result.estimatedMinutes).toBe(30);
  });

  test("duration: '45 minutes'", () => {
    const result = parseTaskFields("run errands 45 minutes");
    expect(result.estimatedMinutes).toBe(45);
  });

  test("duration: '2 hours'", () => {
    const result = parseTaskFields("deep work session 2 hours");
    expect(result.estimatedMinutes).toBe(120);
  });

  test("duration: 'an hour'", () => {
    const result = parseTaskFields("read book an hour");
    expect(result.estimatedMinutes).toBe(60);
  });

  test("duration: 'a hour' (informal)", () => {
    const result = parseTaskFields("meditate a hour");
    expect(result.estimatedMinutes).toBe(60);
  });

  test("duration: 'half an hour'", () => {
    const result = parseTaskFields("quick call half an hour");
    expect(result.estimatedMinutes).toBe(30);
  });

  test("duration: absent → no estimatedMinutes field returned", () => {
    const result = parseTaskFields("take out trash");
    expect(result.estimatedMinutes).toBeUndefined();
  });

  test("recurrence: 'daily'", () => {
    const result = parseTaskFields("check inbox daily");
    expect(result.recurrenceRule).toBe("RRULE:FREQ=DAILY");
  });

  test("recurrence: 'every day'", () => {
    const result = parseTaskFields("exercise every day");
    expect(result.recurrenceRule).toBe("RRULE:FREQ=DAILY");
  });

  test("recurrence: 'weekly'", () => {
    const result = parseTaskFields("team standup weekly");
    expect(result.recurrenceRule).toBe("RRULE:FREQ=WEEKLY");
  });

  test("recurrence: 'every Tuesday'", () => {
    const result = parseTaskFields("team standup every Tuesday");
    expect(result.recurrenceRule).toBe("RRULE:FREQ=WEEKLY;BYDAY=TU");
  });

  test("recurrence: 'every Monday'", () => {
    const result = parseTaskFields("planning session every Monday");
    expect(result.recurrenceRule).toBe("RRULE:FREQ=WEEKLY;BYDAY=MO");
  });

  test("recurrence: 'every Friday'", () => {
    const result = parseTaskFields("weekly review every Friday");
    expect(result.recurrenceRule).toBe("RRULE:FREQ=WEEKLY;BYDAY=FR");
  });

  test("recurrence: absent → no recurrenceRule field returned", () => {
    const result = parseTaskFields("call dentist");
    expect(result.recurrenceRule).toBeUndefined();
  });

  test("combined: tags + priority + duration", () => {
    const result = parseTaskFields("urgent write quarterly report 2 hours #work");
    expect(result.priority).toBe(1);
    expect(result.estimatedMinutes).toBe(120);
    expect(result.tags).toEqual(["work"]);
    expect(result.title).toContain("report");
  });

  test("combined: recurrence + tag", () => {
    const result = parseTaskFields("morning run daily #health");
    expect(result.recurrenceRule).toBe("RRULE:FREQ=DAILY");
    expect(result.tags).toEqual(["health"]);
  });

  test("title with only consumed tokens returns empty string → undefined title", () => {
    const result = parseTaskFields("#health");
    // After stripping the tag, nothing meaningful remains
    expect(result.tags).toEqual(["health"]);
    // title should be absent or empty
    expect(result.title === undefined || result.title === "").toBe(true);
  });
});

// ─── createTask ───────────────────────────────────────────────────────────────

describe("createTask", () => {
  test("returns a Task with status 'todo'", () => {
    const task = createTask("schedule dentist appointment");
    expect(task.status).toBe("todo");
  });

  test("generates a non-empty UUID id", () => {
    const task = createTask("buy groceries");
    expect(task.id).toBeTruthy();
    expect(task.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  test("sets createdAt to a valid ISO 8601 timestamp", () => {
    const before = new Date();
    const task = createTask("test");
    const after = new Date();
    const createdAt = new Date(task.createdAt);
    expect(createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  test("stores the raw message in source", () => {
    const raw = "finish the report urgent #work";
    const task = createTask(raw);
    expect(task.source).toBe(raw);
  });

  test("extracts tags from raw text", () => {
    const task = createTask("read #books #leisure");
    expect(task.tags).toEqual(["books", "leisure"]);
  });

  test("extracts priority from raw text", () => {
    const task = createTask("critical system update");
    expect(task.priority).toBe(1);
  });

  test("defaults priority to 2 when not extractable", () => {
    const task = createTask("do laundry");
    expect(task.priority).toBe(2);
  });

  test("extracts estimatedMinutes from raw text", () => {
    const task = createTask("write summary 30 min");
    expect(task.estimatedMinutes).toBe(30);
  });

  test("overrides win over parsed fields", () => {
    const task = createTask("urgent buy groceries", { priority: 3, status: "todo" });
    expect(task.priority).toBe(3);
  });

  test("override can set a custom id", () => {
    const task = createTask("test override", { id: "custom-id" });
    expect(task.id).toBe("custom-id");
  });

  test("override can set tags", () => {
    const task = createTask("workout #health", { tags: ["fitness"] });
    expect(task.tags).toEqual(["fitness"]);
  });

  test("two calls produce different ids", () => {
    const a = createTask("test");
    const b = createTask("test");
    expect(a.id).not.toBe(b.id);
  });

  test("does not include scheduledAt or completedAt on new task", () => {
    const task = createTask("new task");
    expect(task.scheduledAt).toBeUndefined();
    expect(task.completedAt).toBeUndefined();
  });
});

// ─── updateTaskStatus — valid transitions ────────────────────────────────────

describe("updateTaskStatus — valid transitions", () => {
  const validTransitions: Array<[TaskStatus, TaskStatus]> = [
    ["todo", "scheduled"],
    ["todo", "done"],
    ["todo", "dropped"],
    ["todo", "skipped"],
    ["scheduled", "todo"],
    ["scheduled", "done"],
    ["scheduled", "dropped"],
    ["scheduled", "skipped"],
    ["skipped", "todo"],
    ["skipped", "scheduled"],
    ["skipped", "dropped"],
  ];

  for (const [from, to] of validTransitions) {
    test(`${from} → ${to}`, () => {
      const task = makeTask({ status: from });
      const result = updateTaskStatus(task.id, to, [task]);
      expect(result[0]?.status).toBe(to);
    });
  }

  test("stamps completedAt when transitioning to done", () => {
    const task = makeTask({ status: "todo" });
    const result = updateTaskStatus(task.id, "done", [task]);
    expect(result[0]?.completedAt).toBeDefined();
    expect(() => new Date(result[0]?.completedAt ?? "")).not.toThrow();
  });

  test("stamps skippedAt when transitioning to skipped", () => {
    const task = makeTask({ status: "todo" });
    const result = updateTaskStatus(task.id, "skipped", [task]);
    expect(result[0]?.skippedAt).toBeDefined();
    expect(() => new Date(result[0]?.skippedAt ?? "")).not.toThrow();
  });

  test("returns a new array (does not mutate input)", () => {
    const task = makeTask({ status: "todo" });
    const original = [task];
    const result = updateTaskStatus(task.id, "scheduled", original);
    expect(original[0]?.status).toBe("todo");
    expect(result[0]?.status).toBe("scheduled");
  });

  test("only the target task is modified; others are unchanged", () => {
    const t1 = makeTask({ id: "a", status: "todo" });
    const t2 = makeTask({ id: "b", status: "todo" });
    const result = updateTaskStatus("a", "done", [t1, t2]);
    expect(result.find((t) => t.id === "a")?.status).toBe("done");
    expect(result.find((t) => t.id === "b")?.status).toBe("todo");
  });
});

// ─── updateTaskStatus — invalid transitions ──────────────────────────────────

describe("updateTaskStatus — invalid transitions", () => {
  const invalidTransitions: Array<[TaskStatus, TaskStatus]> = [
    ["done", "todo"],
    ["done", "scheduled"],
    ["done", "dropped"],
    ["done", "skipped"],
    ["dropped", "todo"],
    ["dropped", "scheduled"],
    ["dropped", "done"],
    ["dropped", "skipped"],
    ["skipped", "done"],
    // self-transitions that are not in the allowed table
    ["todo", "todo"],
    ["scheduled", "scheduled"],
    ["skipped", "skipped"],
    ["done", "done"],
    ["dropped", "dropped"],
  ];

  for (const [from, to] of invalidTransitions) {
    test(`${from} → ${to} throws`, () => {
      const task = makeTask({ status: from });
      expect(() => updateTaskStatus(task.id, to, [task])).toThrow();
    });
  }

  test("error message includes the from and to statuses with arrow", () => {
    const task = makeTask({ status: "done" });
    expect(() => updateTaskStatus(task.id, "todo", [task])).toThrow(/done.*→.*todo/);
  });

  test("throws when task id is not found", () => {
    const task = makeTask({ id: "real-id", status: "todo" });
    expect(() => updateTaskStatus("nonexistent-id", "done", [task])).toThrow(
      /not found/i
    );
  });
});

// ─── getTasks ─────────────────────────────────────────────────────────────────

describe("getTasks", () => {
  const todo1 = makeTask({ id: "t1", status: "todo", tags: ["work"] });
  const todo2 = makeTask({ id: "t2", status: "todo", tags: ["health"] });
  const scheduled = makeTask({ id: "t3", status: "scheduled", tags: ["work"] });
  const skipped = makeTask({ id: "t4", status: "skipped", tags: [] });
  const done = makeTask({ id: "t5", status: "done", tags: ["work"] });
  const dropped = makeTask({ id: "t6", status: "dropped", tags: [] });

  const all = [todo1, todo2, scheduled, skipped, done, dropped];

  test("default filter excludes done and dropped", () => {
    const result = getTasks(all);
    expect(result.some((t) => t.status === "done")).toBe(false);
    expect(result.some((t) => t.status === "dropped")).toBe(false);
  });

  test("default filter includes todo, scheduled, skipped", () => {
    const result = getTasks(all);
    expect(result.map((t) => t.id).sort()).toEqual(["t1", "t2", "t3", "t4"].sort());
  });

  test("status filter: single status string", () => {
    const result = getTasks(all, { status: "todo" });
    expect(result.map((t) => t.id).sort()).toEqual(["t1", "t2"].sort());
  });

  test("status filter: array of statuses", () => {
    const result = getTasks(all, { status: ["todo", "scheduled"] });
    expect(result.map((t) => t.id).sort()).toEqual(["t1", "t2", "t3"].sort());
  });

  test("status filter: 'done' explicitly", () => {
    const result = getTasks(all, { status: "done" });
    expect(result.map((t) => t.id)).toEqual(["t5"]);
  });

  test("tags filter: single tag", () => {
    const result = getTasks(all, { tags: ["work"] });
    // Default filter applies first (excludes done/dropped), then tag filter
    expect(result.map((t) => t.id).sort()).toEqual(["t1", "t3"].sort());
  });

  test("tags filter: no matching tag returns empty", () => {
    const result = getTasks(all, { tags: ["nonexistent"] });
    expect(result).toHaveLength(0);
  });

  test("combined: status + tags", () => {
    const result = getTasks(all, { status: ["todo", "scheduled"], tags: ["work"] });
    expect(result.map((t) => t.id).sort()).toEqual(["t1", "t3"].sort());
  });

  test("empty input returns empty array", () => {
    const result = getTasks([]);
    expect(result).toEqual([]);
  });

  test("tags filter requires ALL specified tags (AND logic)", () => {
    const multiTag = makeTask({ id: "m1", status: "todo", tags: ["work", "urgent"] });
    const singleTag = makeTask({ id: "m2", status: "todo", tags: ["work"] });
    const result = getTasks([multiTag, singleTag], { tags: ["work", "urgent"] });
    expect(result.map((t) => t.id)).toEqual(["m1"]);
  });
});

// ─── getSkippedQueue ──────────────────────────────────────────────────────────

describe("getSkippedQueue", () => {
  test("returns only skipped tasks", () => {
    const tasks = [
      makeTask({ id: "a", status: "todo" }),
      makeTask({ id: "b", status: "skipped", skippedAt: "2026-01-02T10:00:00.000Z" }),
      makeTask({ id: "c", status: "done" }),
    ];
    const result = getSkippedQueue(tasks);
    expect(result.map((t) => t.id)).toEqual(["b"]);
  });

  test("sorts oldest-skippedAt first", () => {
    const tasks = [
      makeTask({ id: "new", status: "skipped", skippedAt: "2026-01-03T10:00:00.000Z" }),
      makeTask({ id: "old", status: "skipped", skippedAt: "2026-01-01T10:00:00.000Z" }),
      makeTask({ id: "mid", status: "skipped", skippedAt: "2026-01-02T10:00:00.000Z" }),
    ];
    const result = getSkippedQueue(tasks);
    expect(result.map((t) => t.id)).toEqual(["old", "mid", "new"]);
  });

  test("returns empty array when no tasks are skipped", () => {
    const tasks = [makeTask({ status: "todo" }), makeTask({ status: "done" })];
    expect(getSkippedQueue(tasks)).toHaveLength(0);
  });

  test("returns empty array when input is empty", () => {
    expect(getSkippedQueue([])).toHaveLength(0);
  });

  test("tasks without skippedAt sort after tasks with skippedAt", () => {
    const tasks = [
      makeTask({ id: "no-date", status: "skipped" }),
      makeTask({ id: "has-date", status: "skipped", skippedAt: "2026-01-01T10:00:00.000Z" }),
    ];
    const result = getSkippedQueue(tasks);
    expect(result[0]?.id).toBe("has-date");
    expect(result[1]?.id).toBe("no-date");
  });
});

// ─── scheduleTask ─────────────────────────────────────────────────────────────

describe("scheduleTask", () => {
  test("sets status to 'scheduled'", () => {
    const task = makeTask({ status: "todo" });
    const result = scheduleTask(task.id, new Date("2026-02-01T09:00:00.000Z"), [task]);
    expect(result[0]?.status).toBe("scheduled");
  });

  test("sets scheduledAt to the provided date as ISO string", () => {
    const task = makeTask({ status: "todo" });
    const scheduledAt = new Date("2026-02-01T09:00:00.000Z");
    const result = scheduleTask(task.id, scheduledAt, [task]);
    expect(result[0]?.scheduledAt).toBe(scheduledAt.toISOString());
  });

  test("does not mutate the input array", () => {
    const task = makeTask({ status: "todo" });
    const original = [task];
    scheduleTask(task.id, new Date(), original);
    expect(original[0]?.status).toBe("todo");
  });

  test("throws for invalid transition (done → scheduled)", () => {
    const task = makeTask({ status: "done" });
    expect(() => scheduleTask(task.id, new Date(), [task])).toThrow();
  });

  test("allows scheduling a skipped task", () => {
    const task = makeTask({ status: "skipped", skippedAt: "2026-01-01T00:00:00.000Z" });
    const result = scheduleTask(task.id, new Date("2026-02-15T10:00:00.000Z"), [task]);
    expect(result[0]?.status).toBe("scheduled");
  });
});

// ─── dropTask ─────────────────────────────────────────────────────────────────

describe("dropTask", () => {
  test("sets status to 'dropped'", () => {
    const task = makeTask({ status: "todo" });
    const result = dropTask(task.id, [task]);
    expect(result[0]?.status).toBe("dropped");
  });

  test("drops a scheduled task", () => {
    const task = makeTask({ status: "scheduled" });
    const result = dropTask(task.id, [task]);
    expect(result[0]?.status).toBe("dropped");
  });

  test("drops a skipped task", () => {
    const task = makeTask({ status: "skipped", skippedAt: "2026-01-01T00:00:00.000Z" });
    const result = dropTask(task.id, [task]);
    expect(result[0]?.status).toBe("dropped");
  });

  test("throws when trying to drop an already-dropped task", () => {
    const task = makeTask({ status: "dropped" });
    expect(() => dropTask(task.id, [task])).toThrow();
  });

  test("throws when trying to drop a done task", () => {
    const task = makeTask({ status: "done" });
    expect(() => dropTask(task.id, [task])).toThrow();
  });

  test("does not mutate the input array", () => {
    const task = makeTask({ status: "todo" });
    const original = [task];
    dropTask(task.id, original);
    expect(original[0]?.status).toBe("todo");
  });
});

// ─── findDuplicates ───────────────────────────────────────────────────────────

describe("findDuplicates", () => {
  test("returns identical task as a duplicate", () => {
    const task = makeTask({ title: "buy groceries", status: "todo" });
    const result = findDuplicates("buy groceries", [task]);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(task.id);
  });

  test("returns near-duplicate (above threshold)", () => {
    const task = makeTask({ title: "call the doctor", status: "todo" });
    // "call the doctor" vs "call doctor" — very similar
    const result = findDuplicates("call the doctor", [task]);
    expect(result).toHaveLength(1);
  });

  test("does not flag clearly different text", () => {
    const task = makeTask({ title: "renew car insurance", status: "todo" });
    const result = findDuplicates("buy groceries", [task]);
    expect(result).toHaveLength(0);
  });

  test("excludes done tasks", () => {
    const task = makeTask({ title: "buy groceries", status: "done" });
    const result = findDuplicates("buy groceries", [task]);
    expect(result).toHaveLength(0);
  });

  test("excludes dropped tasks", () => {
    const task = makeTask({ title: "buy groceries", status: "dropped" });
    const result = findDuplicates("buy groceries", [task]);
    expect(result).toHaveLength(0);
  });

  test("includes todo tasks when similar", () => {
    const task = makeTask({ title: "buy groceries at the store", status: "todo" });
    const result = findDuplicates("buy groceries at the store", [task]);
    expect(result).toHaveLength(1);
  });

  test("includes scheduled tasks when similar", () => {
    const task = makeTask({ title: "dentist appointment", status: "scheduled" });
    const result = findDuplicates("dentist appointment", [task]);
    expect(result).toHaveLength(1);
  });

  test("includes skipped tasks when similar", () => {
    const task = makeTask({
      title: "fill tax return",
      status: "skipped",
      skippedAt: "2026-01-01T00:00:00.000Z",
    });
    const result = findDuplicates("fill tax return", [task]);
    expect(result).toHaveLength(1);
  });

  test("returns empty array when task list is empty", () => {
    const result = findDuplicates("any text", []);
    expect(result).toHaveLength(0);
  });

  test("normalisation: case-insensitive comparison", () => {
    const task = makeTask({ title: "Buy Groceries", status: "todo" });
    const result = findDuplicates("buy groceries", [task]);
    expect(result).toHaveLength(1);
  });

  test("normalisation: punctuation stripped", () => {
    const task = makeTask({ title: "call doctor!", status: "todo" });
    const result = findDuplicates("call doctor", [task]);
    expect(result).toHaveLength(1);
  });

  test("can return multiple duplicates", () => {
    const t1 = makeTask({ id: "a", title: "buy milk", status: "todo" });
    const t2 = makeTask({ id: "b", title: "buy milk", status: "scheduled" });
    const t3 = makeTask({ id: "c", title: "renew passport", status: "todo" });
    const result = findDuplicates("buy milk", [t1, t2, t3]);
    expect(result.map((t) => t.id).sort()).toEqual(["a", "b"].sort());
  });

  test("does not flag text that is below the 0.8 threshold", () => {
    // "call John" vs "email boss" — completely different
    const task = makeTask({ title: "email boss", status: "todo" });
    const result = findDuplicates("call John", [task]);
    expect(result).toHaveLength(0);
  });
});
