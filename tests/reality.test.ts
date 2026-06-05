import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { resolve } from "path";
import type { Task, CurrentState } from "../src/types.js";

// ─── Test harness ─────────────────────────────────────────────────────────────
//
// Use the same env-var isolation pattern as storage.test.ts. The env var must
// be set before any module that imports storage.ts is loaded.

// Use the same temp dir as storage.test.ts so both test files resolve to the
// same DATA_DIR constant when Bun caches the storage module across files.
const TEST_DATA_DIR = resolve(import.meta.dir, "../.test-data-tmp");
process.env["PERSONAL_ASSISTANT_DATA_DIR"] = TEST_DATA_DIR;

const { ingestReality, classifyActivityType, getCurrentState, parseMessageTime } =
  await import("../src/reality.js");

const { readActivityLog, readCurrentState, writeCurrentState, writeTasks } =
  await import("../src/storage.js");

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

// ─── classifyActivityType ──────────────────────────────────────────────────────

describe("classifyActivityType", () => {
  it("classifies 'finished the report' as completed", () => {
    expect(classifyActivityType("finished the report")).toBe("completed");
  });

  it("classifies 'called John' as completed", () => {
    expect(classifyActivityType("called John")).toBe("completed");
  });

  it("classifies 'completed my tasks' as completed", () => {
    expect(classifyActivityType("completed my tasks")).toBe("completed");
  });

  it("classifies 'sent the email' as completed", () => {
    expect(classifyActivityType("sent the email")).toBe("completed");
  });

  it("classifies 'did the dishes' as completed", () => {
    expect(classifyActivityType("did the dishes")).toBe("completed");
  });

  it("classifies 'starting my workout' as started", () => {
    expect(classifyActivityType("starting my workout")).toBe("started");
  });

  it("classifies 'beginning the project' as started", () => {
    expect(classifyActivityType("beginning the project")).toBe("started");
  });

  it("classifies 'at the office' as status", () => {
    expect(classifyActivityType("at the office")).toBe("status");
  });

  it("classifies 'heading to the gym' as status", () => {
    expect(classifyActivityType("heading to the gym")).toBe("status");
  });

  it("classifies 'in a meeting' as status", () => {
    expect(classifyActivityType("in a meeting")).toBe("status");
  });

  it("classifies 'just some random thought' as note", () => {
    expect(classifyActivityType("just some random thought")).toBe("note");
  });

  it("classifies empty-ish text as note", () => {
    expect(classifyActivityType("remember to buy milk")).toBe("note");
  });
});

// ─── parseMessageTime ──────────────────────────────────────────────────────────

describe("parseMessageTime", () => {
  const baseDate = new Date("2026-06-04T09:00:00.000Z");

  it("returns now when no time hint is present", () => {
    const result = parseMessageTime("went to the park", baseDate);
    expect(result.getTime()).toBe(baseDate.getTime());
  });

  it("parses 'at 7' as 07:00 local time today", () => {
    const now = new Date("2026-06-04T09:30:00.000");
    const result = parseMessageTime("woke up at 7", now);
    expect(result.getHours()).toBe(7);
    expect(result.getMinutes()).toBe(0);
    // Date part matches today
    expect(result.getFullYear()).toBe(now.getFullYear());
    expect(result.getMonth()).toBe(now.getMonth());
    expect(result.getDate()).toBe(now.getDate());
  });

  it("parses 'at 9:30am' correctly", () => {
    const now = new Date("2026-06-04T12:00:00.000");
    const result = parseMessageTime("meeting at 9:30am", now);
    expect(result.getHours()).toBe(9);
    expect(result.getMinutes()).toBe(30);
  });

  it("parses 'at 9:30pm' correctly", () => {
    const now = new Date("2026-06-04T12:00:00.000");
    const result = parseMessageTime("finished at 9:30pm", now);
    expect(result.getHours()).toBe(21);
    expect(result.getMinutes()).toBe(30);
  });

  it("parses 24-hour 'at 14:00' correctly", () => {
    const now = new Date("2026-06-04T12:00:00.000");
    const result = parseMessageTime("lunch at 14:00", now);
    expect(result.getHours()).toBe(14);
    expect(result.getMinutes()).toBe(0);
  });

  it("parses 'this morning' as 08:00", () => {
    const now = new Date("2026-06-04T12:00:00.000");
    const result = parseMessageTime("went to gym this morning", now);
    expect(result.getHours()).toBe(8);
    expect(result.getMinutes()).toBe(0);
  });

  it("parses 'this afternoon' as 14:00", () => {
    const now = new Date("2026-06-04T12:00:00.000");
    const result = parseMessageTime("had a nap this afternoon", now);
    expect(result.getHours()).toBe(14);
    expect(result.getMinutes()).toBe(0);
  });

  it("parses 'this evening' as 19:00", () => {
    const now = new Date("2026-06-04T18:00:00.000");
    const result = parseMessageTime("dinner this evening", now);
    expect(result.getHours()).toBe(19);
    expect(result.getMinutes()).toBe(0);
  });

  it("parses 'tonight' as 19:00", () => {
    const now = new Date("2026-06-04T18:00:00.000");
    const result = parseMessageTime("going out tonight", now);
    expect(result.getHours()).toBe(19);
    expect(result.getMinutes()).toBe(0);
  });
});

// ─── ingestReality — auto-timestamp ──────────────────────────────────────────

describe("ingestReality — auto-timestamp", () => {
  beforeEach(clearTestData);

  it("creates an ActivityEntry with a timestamp close to now when no time is specified", async () => {
    const before = Date.now();
    const { entry } = await ingestReality("just having a coffee", []);
    const after = Date.now();

    const entryMs = new Date(entry.timestamp).getTime();
    expect(entryMs).toBeGreaterThanOrEqual(before);
    expect(entryMs).toBeLessThanOrEqual(after);
  });

  it("appends the entry to the activity log on disk", async () => {
    await ingestReality("went for a walk", []);
    const log = readActivityLog();
    expect(log).toHaveLength(1);
    expect(log[0]?.rawText).toBe("went for a walk");
  });

  it("classifies and stores the correct activity type", async () => {
    const { entry } = await ingestReality("finished the report", []);
    expect(entry.type).toBe("completed");
  });

  it("assigns a unique id to each entry", async () => {
    const { entry: a } = await ingestReality("first message", []);
    const { entry: b } = await ingestReality("second message", []);
    expect(a.id).not.toBe(b.id);
  });

  it("returns rawText unchanged", async () => {
    const msg = "At the coffee shop";
    const { entry } = await ingestReality(msg, []);
    expect(entry.rawText).toBe(msg);
  });
});

// ─── ingestReality — user-supplied time ──────────────────────────────────────

describe("ingestReality — user-supplied time", () => {
  beforeEach(clearTestData);

  it("uses the user-supplied hour when message contains 'at H'", async () => {
    const { entry } = await ingestReality("woke up at 7", []);
    expect(new Date(entry.timestamp).getHours()).toBe(7);
  });

  it("uses 08:00 for 'this morning'", async () => {
    const { entry } = await ingestReality("went to gym this morning", []);
    expect(new Date(entry.timestamp).getHours()).toBe(8);
  });

  it("uses 14:00 for 'this afternoon'", async () => {
    const { entry } = await ingestReality("napped this afternoon", []);
    expect(new Date(entry.timestamp).getHours()).toBe(14);
  });

  it("uses 19:00 for 'tonight'", async () => {
    const { entry } = await ingestReality("went out tonight", []);
    expect(new Date(entry.timestamp).getHours()).toBe(19);
  });
});

// ─── ingestReality — intent closing ──────────────────────────────────────────

describe("ingestReality — intent closing", () => {
  beforeEach(clearTestData);

  it("closes the single matching open task on exact keyword match", async () => {
    const tasks: Task[] = [makeTask({ id: "t-1", title: "Write report" })];
    const { closedTaskId } = await ingestReality("finished the report", tasks);
    expect(closedTaskId).toBe("t-1");
  });

  it("stores closedTaskId on the ActivityEntry", async () => {
    const tasks: Task[] = [makeTask({ id: "t-2", title: "Call dentist" })];
    const { entry } = await ingestReality("called the dentist", tasks);
    expect(entry.closedTaskId).toBe("t-2");
  });

  it("does not close when multiple tasks match", async () => {
    const tasks: Task[] = [
      makeTask({ id: "t-3", title: "Write report" }),
      makeTask({ id: "t-4", title: "Review report" }),
    ];
    const { closedTaskId } = await ingestReality("finished the report", tasks);
    expect(closedTaskId).toBeUndefined();
  });

  it("does not close when no task matches", async () => {
    const tasks: Task[] = [makeTask({ id: "t-5", title: "Buy groceries" })];
    const { closedTaskId } = await ingestReality("finished the report", tasks);
    expect(closedTaskId).toBeUndefined();
  });

  it("does not close done or dropped tasks", async () => {
    const tasks: Task[] = [
      makeTask({ id: "t-6", title: "Call dentist", status: "done" }),
      makeTask({ id: "t-7", title: "Submit report", status: "dropped" }),
    ];
    const { closedTaskId } = await ingestReality("called the dentist", tasks);
    expect(closedTaskId).toBeUndefined();
  });

  it("closes a 'scheduled' status task as well as 'todo'", async () => {
    const tasks: Task[] = [
      makeTask({ id: "t-8", title: "Buy groceries", status: "scheduled" }),
    ];
    const { closedTaskId } = await ingestReality("did the groceries", tasks);
    expect(closedTaskId).toBe("t-8");
  });

  it("returns no closedTaskId and entry has no closedTaskId when no match", async () => {
    const { entry, closedTaskId } = await ingestReality("just having a coffee", []);
    expect(closedTaskId).toBeUndefined();
    expect(entry.closedTaskId).toBeUndefined();
  });
});

// ─── getCurrentState — staleness ─────────────────────────────────────────────

describe("getCurrentState — staleness", () => {
  beforeEach(clearTestData);

  it("returns 'fresh' when lastObservedAt is less than 12 hours ago", () => {
    const elevenHoursAgo = new Date(Date.now() - 11 * 60 * 60 * 1000);
    writeCurrentState({
      lastObservation: "At the office",
      lastObservedAt: elevenHoursAgo.toISOString(),
      staleness: "fresh", // stored value should be ignored; computed at read time
    });

    const state = getCurrentState();
    expect(state.staleness).toBe("fresh");
  });

  it("returns 'stale' when lastObservedAt is between 12 and 24 hours ago", () => {
    const thirteenHoursAgo = new Date(Date.now() - 13 * 60 * 60 * 1000);
    writeCurrentState({
      lastObservation: "Left the office",
      lastObservedAt: thirteenHoursAgo.toISOString(),
      staleness: "fresh", // intentionally wrong stored value to verify recomputation
    });

    const state = getCurrentState();
    expect(state.staleness).toBe("stale");
  });

  it("returns 'unknown' when lastObservedAt is more than 24 hours ago", () => {
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    writeCurrentState({
      lastObservation: "Long time ago",
      lastObservedAt: twentyFiveHoursAgo.toISOString(),
      staleness: "fresh", // intentionally wrong stored value to verify recomputation
    });

    const state = getCurrentState();
    expect(state.staleness).toBe("unknown");
  });

  it("returns 'unknown' when no state file exists (epoch default)", () => {
    // clearTestData removed any existing state file
    const state = getCurrentState();
    expect(state.staleness).toBe("unknown");
  });

  it("recomputes staleness at read time, not trusting the stored field", () => {
    // Write a state that was 'fresh' 13 hours ago — stored as 'fresh'
    const thirteenHoursAgo = new Date(Date.now() - 13 * 60 * 60 * 1000);
    writeCurrentState({
      lastObservation: "at the office",
      lastObservedAt: thirteenHoursAgo.toISOString(),
      staleness: "fresh",
    });

    // getCurrentState must return 'stale', not the stored 'fresh'
    expect(getCurrentState().staleness).toBe("stale");
  });

  it("preserves lastObservation and lastObservedAt from disk", () => {
    const ts = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    writeCurrentState({
      lastObservation: "at coffee shop",
      lastObservedAt: ts,
      staleness: "fresh",
    });

    const state = getCurrentState();
    expect(state.lastObservation).toBe("at coffee shop");
    expect(state.lastObservedAt).toBe(ts);
  });
});

// ─── ingestReality — CurrentState update ─────────────────────────────────────

describe("ingestReality — updates CurrentState", () => {
  beforeEach(clearTestData);

  it("writes lastObservation to disk matching the raw message", async () => {
    await ingestReality("in a meeting", []);
    const state = readCurrentState();
    expect(state.lastObservation).toBe("in a meeting");
  });

  it("written CurrentState has a fresh staleness when message is ingested now", async () => {
    await ingestReality("just arrived at the office", []);
    const state = getCurrentState();
    expect(state.staleness).toBe("fresh");
  });
});

// ─── Cleanup ──────────────────────────────────────────────────────────────────

afterEach(clearTestData);
