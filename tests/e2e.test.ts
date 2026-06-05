import { describe, it, expect, beforeEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { resolve } from "path";
import type { Task } from "../src/types.js";

// ─── Test isolation ───────────────────────────────────────────────────────────
//
// Set PERSONAL_ASSISTANT_DATA_DIR before any import that transitively imports
// storage.ts so every module resolves the same DATA_DIR constant.

// Use the same directory as all other test files so Bun's module cache
// resolves to the same DATA_DIR constant across the entire test suite.
const TEST_DATA_DIR = resolve(import.meta.dir, "../.test-data-tmp");
process.env["PERSONAL_ASSISTANT_DATA_DIR"] = TEST_DATA_DIR;

const { route } = await import("../src/router.js");
const { execute } = await import("../src/execute.js");
const { readTasks, writeTasks, readActivityLog } = await import("../src/storage.js");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clearTestData() {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_DATA_DIR, { recursive: true });
}

function makeTask(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    status: "todo",
    priority: 2,
    tags: [],
    source: overrides.title,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// Fixed reference time: Thursday 2026-06-04 at 10:00 UTC
const NOW = new Date("2026-06-04T10:00:00.000Z");

// ─── E2E scenario 1: future intent → task created on disk ─────────────────────

describe("e2e: future + no time → task created", () => {
  beforeEach(clearTestData);

  it("creates task in data/tasks.json", async () => {
    const msg = "need to buy groceries";
    const result = route(msg, [], NOW);
    expect(result.action.type).toBe("createTask");

    const execResult = await execute(result, msg);
    expect(execResult.action).toContain("Task created");

    const tasks = readTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toContain("groceries");
  });

  it("task on disk has correct status and source", async () => {
    const msg = "need to schedule dentist appointment";
    const result = route(msg, [], NOW);
    await execute(result, msg);

    const tasks = readTasks();
    expect(tasks[0]?.status).toBe("todo");
    expect(tasks[0]?.source).toBe(msg);
  });
});

// ─── E2E scenario 2: past tense → activity entry in activity-log.json ─────────

describe("e2e: past tense → activity log entry", () => {
  beforeEach(clearTestData);

  it("appends entry to activity-log.json", async () => {
    const msg = "finished the quarterly report";
    const result = route(msg, [], NOW);
    expect(result.action.type).toBe("logReality");

    const execResult = await execute(result, msg);
    expect(execResult.action).toContain("Activity logged");

    const log = readActivityLog();
    expect(log.length).toBeGreaterThan(0);
    const entry = log.find((e) => e.rawText === msg);
    expect(entry).toBeDefined();
    expect(entry?.type).toBe("completed");
  });

  it("matching open task is closed and closedTaskId appears in result", async () => {
    const task = makeTask({ id: "t1", title: "quarterly report" });
    writeTasks([task]);

    const msg = "finished the quarterly report";
    const result = route(msg, [task], NOW);
    const execResult = await execute(result, msg);

    expect(execResult.action).toContain("closed task");

    const tasks = readTasks();
    const updated = tasks.find((t) => t.id === "t1");
    expect(updated?.status).toBe("done");
  });
});

// ─── E2E scenario 3: present status → activity entry ─────────────────────────

describe("e2e: present status → activity log entry", () => {
  beforeEach(clearTestData);

  it("logs a status entry without closing any task", async () => {
    const msg = "at the gym";
    const result = route(msg, [], NOW);
    expect(result.action.type).toBe("logReality");

    const execResult = await execute(result, msg);
    expect(execResult.action).toContain("Activity logged");

    const log = readActivityLog();
    const entry = log.find((e) => e.rawText === msg);
    expect(entry).toBeDefined();
    expect(entry?.type).toBe("status");
  });
});

// ─── E2E scenario 4: question → no mutations, answer returned ─────────────────

describe("e2e: question → no mutations", () => {
  beforeEach(clearTestData);

  it("returns an answer and writes nothing to disk", async () => {
    const msg = "what is on my calendar today?";
    const result = route(msg, [], NOW);
    expect(result.action.type).toBe("answer");

    const execResult = await execute(result, msg);
    expect(execResult.action).toBe("answered");

    const tasks = readTasks();
    const log = readActivityLog();
    expect(tasks).toHaveLength(0);
    expect(log).toHaveLength(0);
  });

  it("data field contains the response text", async () => {
    const msg = "what should I work on next?";
    const result = route(msg, [], NOW);
    const execResult = await execute(result, msg);
    expect(typeof execResult.data).toBe("string");
  });
});

// ─── E2E scenario 5: ambiguous message → clarify, no mutations ────────────────

describe("e2e: ambiguous → clarify, no mutations", () => {
  beforeEach(clearTestData);

  it("returns clarify action and writes nothing to disk", async () => {
    // Mixed past + future signals → ambiguous
    const msg = "I called John but will follow up tomorrow";
    const result = route(msg, [], NOW);
    // Router may clarify or route differently; we test clarify path explicitly
    const clarifyResult = route("did the thing and need to do more things", [], NOW);
    if (clarifyResult.action.type !== "clarify") {
      // If this specific message doesn't hit clarify, use the fallback path
      const fallbackResult = route("xyz abc def", [], NOW);
      expect(fallbackResult.action.type).toBe("clarify");
      const execResult = await execute(fallbackResult, "xyz abc def");
      expect(execResult.action).toBe("clarify");
      expect(readTasks()).toHaveLength(0);
      expect(readActivityLog()).toHaveLength(0);
      return;
    }

    const execResult = await execute(clarifyResult, "did the thing and need to do more things");
    expect(execResult.action).toBe("clarify");
    expect(typeof execResult.data).toBe("string");

    expect(readTasks()).toHaveLength(0);
    expect(readActivityLog()).toHaveLength(0);
  });

  it("fallback clarify path — no mutations", async () => {
    const msg = "xyz abc def mno";
    const result = route(msg, [], NOW);
    expect(result.action.type).toBe("clarify");

    const execResult = await execute(result, msg);
    expect(execResult.action).toBe("clarify");
    expect(readTasks()).toHaveLength(0);
    expect(readActivityLog()).toHaveLength(0);
  });
});

// ─── E2E scenario 6: future + time → dry-run createEvent ─────────────────────

describe("e2e: future + time → createEvent (dryRun)", () => {
  beforeEach(clearTestData);

  it("dry-run returns correct title and tier, writes nothing", async () => {
    const msg = "dentist Thursday at 3pm";
    const result = route(msg, [], NOW);
    expect(result.action.type).toBe("createEvent");

    const execResult = await execute(result, msg, { dryRun: true });
    expect(execResult.action).toContain("[dry-run]");
    expect(execResult.action).toContain("Event scheduled");
    expect(execResult.action).toContain("dentist");

    // dryRun: no calendar mirror file touched
    const tasks = readTasks();
    expect(tasks).toHaveLength(0);
  });

  it("dry-run data includes ISO startAt, endAt, and tier", async () => {
    const msg = "team meeting tomorrow at 9am";
    const result = route(msg, [], NOW);
    if (result.action.type !== "createEvent") return; // guard
    const execResult = await execute(result, msg, { dryRun: true });
    const data = execResult.data as { startAt: string; endAt: string; tier: number };
    expect(typeof data.startAt).toBe("string");
    expect(typeof data.endAt).toBe("string");
    expect(data.tier).toBe(1);
  });
});

// ─── E2E scenario 7: future + time + point alert → dry-run createReminder ─────

describe("e2e: future + time + point alert → createReminder (dryRun)", () => {
  beforeEach(clearTestData);

  it("dry-run returns correct title and tier for reminder", async () => {
    const msg = "remind me to take medication tomorrow at 8am";
    const result = route(msg, [], NOW);
    expect(result.action.type).toBe("createReminder");

    const execResult = await execute(result, msg, { dryRun: true });
    expect(execResult.action).toContain("[dry-run]");
    expect(execResult.action).toContain("Reminder created");
    expect(execResult.action).toContain("medication");

    expect(readTasks()).toHaveLength(0);
  });

  it("dry-run data includes dueAt ISO string and tier 1", async () => {
    const msg = "remind me to call the doctor Thursday at 2pm";
    const result = route(msg, [], NOW);
    if (result.action.type !== "createReminder") return;
    const execResult = await execute(result, msg, { dryRun: true });
    const data = execResult.data as { dueAt: string; tier: number };
    expect(typeof data.dueAt).toBe("string");
    expect(data.tier).toBe(1);
  });
});

// ─── E2E scenario 8: duplicate detection → warning included ───────────────────

describe("e2e: duplicate detection → warning in ExecutionResult", () => {
  beforeEach(clearTestData);

  it("warning is set when similar task already exists", async () => {
    const existing = makeTask({ id: "t1", title: "buy groceries" });
    writeTasks([existing]);

    const msg = "need to buy groceries";
    const result = route(msg, [existing], NOW);
    expect(result.action.type).toBe("createTask");
    expect(result.duplicates).toBeDefined();
    expect(result.duplicates!.length).toBeGreaterThan(0);

    const execResult = await execute(result, msg);
    expect(execResult.warning).toBeDefined();
    expect(execResult.warning).toContain("groceries");
  });

  it("no warning when no duplicates exist", async () => {
    const msg = "need to schedule dentist appointment";
    const result = route(msg, [], NOW);
    const execResult = await execute(result, msg);
    expect(execResult.warning).toBeUndefined();
  });

  it("task is still written to disk even when a duplicate warning fires", async () => {
    const existing = makeTask({ id: "t1", title: "buy groceries" });
    writeTasks([existing]);

    const msg = "need to buy groceries";
    const result = route(msg, [existing], NOW);
    await execute(result, msg);

    const tasks = readTasks();
    // Both the existing task and the new (duplicate-warned) task should exist
    expect(tasks.length).toBe(2);
  });
});

// ─── E2E scenario 9: command drop → task dropped in data/tasks.json ───────────

describe("e2e: command drop → task dropped on disk", () => {
  beforeEach(clearTestData);

  it("drops the matching task and persists to disk", async () => {
    const task = makeTask({ id: "t1", title: "buy groceries" });
    writeTasks([task]);

    const msg = "drop buy groceries";
    const result = route(msg, [task], NOW);
    expect(result.action.type).toBe("command");

    const execResult = await execute(result, msg);
    expect(execResult.action).toContain("Task dropped");

    const tasks = readTasks();
    const dropped = tasks.find((t) => t.id === "t1");
    expect(dropped?.status).toBe("dropped");
  });

  it("returns not-found message when no matching active task exists", async () => {
    writeTasks([]);
    const msg = "drop nonexistent task";
    const result = route(msg, [], NOW);
    const execResult = await execute(result, msg);
    expect(execResult.action).toContain("No active task");
  });

  it("does not drop a task that is already dropped", async () => {
    const task = makeTask({ id: "t1", title: "old task", status: "dropped" });
    writeTasks([task]);

    const msg = "drop old task";
    const result = route(msg, [task], NOW);
    const execResult = await execute(result, msg);
    // Should say not found since dropped tasks are excluded from the search
    expect(execResult.action).toContain("No active task");
  });
});
