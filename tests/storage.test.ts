import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import type {
  Task,
  ActivityEntry,
  CalendarMirrorEntry,
  CurrentState,
  PolicyConfig,
  InboxEntry,
} from "../src/types.js";

// ─── Test harness ─────────────────────────────────────────────────────────────
//
// storage.ts resolves DATA_DIR relative to `import.meta.dir` (the src/ folder).
// We override it by monkeypatching the module after pointing DATA_DIR at a temp
// directory — but Bun's ESM cache makes that awkward. Instead we reach into the
// module internals through a test-only re-export shim, or we simply test the
// exported functions directly and use a unique temp dir per test run by
// temporarily redirecting the data path via an env var read at module load time.
//
// Simplest safe approach: set DATA_DIR to a temp path via env BEFORE import, so
// the module picks it up on first load. Bun evaluates the module once per
// process, so we use a single shared temp dir and clean up between tests.

const TEST_DATA_DIR = resolve(import.meta.dir, "../.test-data-tmp");

// Must be set before the storage module is imported so the constant is evaluated
// with the patched path.
process.env["PERSONAL_ASSISTANT_DATA_DIR"] = TEST_DATA_DIR;

// Now import — module reads the env var to determine DATA_DIR.
const {
  readTasks,
  writeTasks,
  readActivityLog,
  writeActivityLog,
  readCalendarMirror,
  writeCalendarMirror,
  readCurrentState,
  writeCurrentState,
  readPolicy,
  writePolicy,
  readInbox,
  writeInbox,
  appendInboxEntry,
} = await import("../src/storage.js");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clearTestData() {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_DATA_DIR, { recursive: true });
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

describe("readTasks", () => {
  beforeEach(clearTestData);

  it("returns empty array when file does not exist", () => {
    expect(readTasks()).toEqual([]);
  });

  it("round-trips a Task array", () => {
    const tasks: Task[] = [
      {
        id: "task-1",
        title: "Buy groceries",
        status: "todo",
        priority: 2,
        tags: ["errand"],
        source: "buy groceries",
        createdAt: "2026-06-04T10:00:00.000Z",
      },
    ];
    writeTasks(tasks);
    expect(readTasks()).toEqual(tasks);
  });

  it("persists all optional fields when present", () => {
    const task: Task = {
      id: "task-2",
      title: "Morning run",
      status: "scheduled",
      priority: 1,
      estimatedMinutes: 30,
      recurrenceRule: "FREQ=DAILY",
      tags: ["health", "routine"],
      source: "morning run every day",
      createdAt: "2026-06-04T06:00:00.000Z",
      scheduledAt: "2026-06-05T07:00:00.000Z",
    };
    writeTasks([task]);
    expect(readTasks()[0]).toEqual(task);
  });

  it("overwrites previous data on write", () => {
    writeTasks([
      {
        id: "old",
        title: "Old task",
        status: "todo",
        priority: 3,
        tags: [],
        source: "old",
        createdAt: "2026-06-01T00:00:00.000Z",
      },
    ]);
    writeTasks([]);
    expect(readTasks()).toEqual([]);
  });
});

// ─── Activity Log ─────────────────────────────────────────────────────────────

describe("readActivityLog", () => {
  beforeEach(clearTestData);

  it("returns empty array when file does not exist", () => {
    expect(readActivityLog()).toEqual([]);
  });

  it("round-trips an ActivityEntry array", () => {
    const entries: ActivityEntry[] = [
      {
        id: "act-1",
        timestamp: "2026-06-04T14:00:00.000Z",
        type: "completed",
        rawText: "Just finished the report",
        parsedFields: { subject: "report" },
        closedTaskId: "task-1",
      },
    ];
    writeActivityLog(entries);
    expect(readActivityLog()).toEqual(entries);
  });

  it("round-trips an entry without optional closedTaskId", () => {
    const entry: ActivityEntry = {
      id: "act-2",
      timestamp: "2026-06-04T15:00:00.000Z",
      type: "note",
      rawText: "Feeling productive",
      parsedFields: {},
    };
    writeActivityLog([entry]);
    expect(readActivityLog()[0]).toEqual(entry);
  });
});

// ─── Calendar Mirror ──────────────────────────────────────────────────────────

describe("readCalendarMirror", () => {
  beforeEach(clearTestData);

  it("returns empty array when file does not exist", () => {
    expect(readCalendarMirror()).toEqual([]);
  });

  it("round-trips a CalendarMirrorEntry array", () => {
    const entries: CalendarMirrorEntry[] = [
      {
        id: "cm-1",
        externalId: "EKEvent-abc123",
        title: "Team standup",
        startAt: "2026-06-05T09:00:00.000Z",
        endAt: "2026-06-05T09:15:00.000Z",
        isReminder: false,
        tier: 2,
        createdAt: "2026-06-04T10:00:00.000Z",
        undone: false,
      },
    ];
    writeCalendarMirror(entries);
    expect(readCalendarMirror()).toEqual(entries);
  });

  it("preserves isReminder:true and absent endAt for Reminders entries", () => {
    const entry: CalendarMirrorEntry = {
      id: "cm-2",
      externalId: "EKReminder-xyz",
      title: "Call dentist",
      startAt: "2026-06-06T10:00:00.000Z",
      isReminder: true,
      tier: 1,
      createdAt: "2026-06-04T11:00:00.000Z",
      undone: false,
    };
    writeCalendarMirror([entry]);
    expect(readCalendarMirror()[0]).toEqual(entry);
  });
});

// ─── Current State ────────────────────────────────────────────────────────────

describe("readCurrentState", () => {
  beforeEach(clearTestData);

  it("returns safe default when file does not exist", () => {
    const state = readCurrentState();
    expect(state.staleness).toBe("unknown");
    expect(state.lastObservation).toBe("");
  });

  it("round-trips a CurrentState object", () => {
    const state: CurrentState = {
      lastObservation: "At the office, deep in code",
      lastObservedAt: "2026-06-04T13:00:00.000Z",
      staleness: "fresh",
      location: "office",
      activity: "coding",
    };
    writeCurrentState(state);
    expect(readCurrentState()).toEqual(state);
  });

  it("round-trips state without optional location/activity", () => {
    const state: CurrentState = {
      lastObservation: "heading home",
      lastObservedAt: "2026-06-04T18:30:00.000Z",
      staleness: "stale",
    };
    writeCurrentState(state);
    expect(readCurrentState()).toEqual(state);
  });
});

// ─── Policy Config ────────────────────────────────────────────────────────────

describe("readPolicy", () => {
  beforeEach(clearTestData);

  it("returns safe default when file does not exist", () => {
    const policy = readPolicy();
    expect(policy.bufferMinutes).toBe(15);
    expect(policy.staleAfterHours).toBe(12);
    expect(policy.dailyCap).toBe(5);
    expect(policy.defaultPriority).toBe(2);
    expect(policy.allowedWindows).toEqual([]);
    expect(policy.blackoutWindows).toEqual([]);
  });

  it("round-trips a PolicyConfig object", () => {
    const policy: PolicyConfig = {
      allowedWindows: [{ start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5] }],
      blackoutWindows: [{ start: "12:00", end: "13:00", days: [1, 2, 3, 4, 5] }],
      bufferMinutes: 10,
      dailyCap: 3,
      staleAfterHours: 8,
      defaultPriority: 1,
    };
    writePolicy(policy);
    expect(readPolicy()).toEqual(policy);
  });
});

// ─── Inbox ───────────────────────────────────────────────────────────────────

describe("readInbox / appendInboxEntry", () => {
  beforeEach(clearTestData);

  it("returns empty array when file does not exist", () => {
    expect(readInbox()).toEqual([]);
  });

  it("round-trips an InboxEntry array via writeInbox", () => {
    const entries: InboxEntry[] = [
      {
        id: "inbox-1",
        receivedAt: "2026-06-04T09:00:00.000Z",
        rawText: "remind me to call mum",
        processed: false,
      },
    ];
    writeInbox(entries);
    expect(readInbox()).toEqual(entries);
  });

  it("appendInboxEntry adds to existing entries without overwriting", () => {
    const first: InboxEntry = {
      id: "inbox-1",
      receivedAt: "2026-06-04T09:00:00.000Z",
      rawText: "first message",
      processed: false,
    };
    appendInboxEntry(first);

    const second: InboxEntry = {
      id: "inbox-2",
      receivedAt: "2026-06-04T09:01:00.000Z",
      rawText: "second message",
      processed: false,
    };
    appendInboxEntry(second);

    const inbox = readInbox();
    expect(inbox).toHaveLength(2);
    expect(inbox[0]).toEqual(first);
    expect(inbox[1]).toEqual(second);
  });

  it("marks processed:true round-trips correctly", () => {
    const entry: InboxEntry = {
      id: "inbox-3",
      receivedAt: "2026-06-04T10:00:00.000Z",
      rawText: "processed message",
      processed: true,
    };
    writeInbox([entry]);
    expect(readInbox()[0]?.processed).toBe(true);
  });
});

// ─── Atomic write behaviour ───────────────────────────────────────────────────

describe("atomic write", () => {
  beforeEach(clearTestData);

  it("leaves no .tmp file on disk after a successful write", () => {
    writeTasks([]);
    const files = readdirSync(TEST_DATA_DIR);
    const tmpFiles = files.filter((f: string) => f.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });

  it("produces valid JSON that JSON.parse can round-trip", () => {
    const tasks: Task[] = [
      {
        id: "atomic-1",
        title: "Atomic test",
        status: "todo",
        priority: 1,
        tags: [],
        source: "test",
        createdAt: new Date().toISOString(),
      },
    ];
    writeTasks(tasks);
    const raw = readFileSync(resolve(TEST_DATA_DIR, "tasks.json"), "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(JSON.parse(raw)).toEqual(tasks);
  });

  it("creates the data directory if it does not exist", () => {
    // clearTestData creates the dir; remove it to simulate first-run
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    expect(existsSync(TEST_DATA_DIR)).toBe(false);
    writeTasks([]);
    expect(existsSync(TEST_DATA_DIR)).toBe(true);
  });
});

// ─── Missing-file defaults (all stores) ──────────────────────────────────────

describe("missing-file defaults", () => {
  beforeEach(clearTestData);

  it("readTasks returns []", () => {
    expect(readTasks()).toEqual([]);
  });

  it("readActivityLog returns []", () => {
    expect(readActivityLog()).toEqual([]);
  });

  it("readCalendarMirror returns []", () => {
    expect(readCalendarMirror()).toEqual([]);
  });

  it("readInbox returns []", () => {
    expect(readInbox()).toEqual([]);
  });

  it("readCurrentState returns object with staleness='unknown'", () => {
    expect(readCurrentState().staleness).toBe("unknown");
  });

  it("readPolicy returns object with staleAfterHours=12", () => {
    expect(readPolicy().staleAfterHours).toBe(12);
  });
});

// ─── Edge case: corrupt JSON on disk ──────────────────────────────────────────

describe("corrupt JSON recovery", () => {
  beforeEach(clearTestData);

  it("readTasks returns empty array when tasks.json is malformed", () => {
    const taskPath = resolve(TEST_DATA_DIR, "tasks.json");
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    writeFileSync(taskPath, "{broken", "utf8");
    expect(readTasks()).toEqual([]);
  });

  it("readActivityLog returns empty array when activity-log.json is malformed", () => {
    const logPath = resolve(TEST_DATA_DIR, "activity-log.json");
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    writeFileSync(logPath, '{"incomplete":', "utf8");
    expect(readActivityLog()).toEqual([]);
  });

  it("readCalendarMirror returns empty array when calendar-mirror.json is malformed", () => {
    const mirrorPath = resolve(TEST_DATA_DIR, "calendar-mirror.json");
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    writeFileSync(mirrorPath, "[1, 2, 3", "utf8");
    expect(readCalendarMirror()).toEqual([]);
  });

  it("readCurrentState returns default when current-state.json is malformed", () => {
    const statePath = resolve(TEST_DATA_DIR, "current-state.json");
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    writeFileSync(statePath, "null", "utf8");
    const state = readCurrentState();
    expect(state.staleness).toBe("unknown");
    expect(state.lastObservation).toBe("");
  });

  it("readPolicy returns default when policy.json is malformed", () => {
    const policyPath = resolve(TEST_DATA_DIR, "policy.json");
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    writeFileSync(policyPath, "!!!", "utf8");
    const policy = readPolicy();
    expect(policy.staleAfterHours).toBe(12);
    expect(policy.bufferMinutes).toBe(15);
  });

  it("readInbox returns empty array when inbox.json contains invalid JSON", () => {
    const inboxPath = resolve(TEST_DATA_DIR, "inbox.json");
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    writeFileSync(inboxPath, '[unclosed', "utf8");
    expect(readInbox()).toEqual([]);
  });

  it("subsequent write after corrupt file overwrites with valid JSON", () => {
    const tasksPath = resolve(TEST_DATA_DIR, "tasks.json");
    mkdirSync(TEST_DATA_DIR, { recursive: true });
    writeFileSync(tasksPath, "corrupt", "utf8");

    const task: Task = {
      id: "task-after-corrupt",
      title: "Valid task",
      status: "todo",
      priority: 2,
      tags: [],
      source: "test",
      createdAt: "2026-06-04T10:00:00.000Z",
    };
    writeTasks([task]);

    const read = readTasks();
    expect(read).toHaveLength(1);
    expect(read[0]).toEqual(task);
  });
});

// ─── Edge case: concurrent append safety ──────────────────────────────────────

describe("concurrent append safety", () => {
  beforeEach(clearTestData);

  it("two rapid appendInboxEntry calls preserve both entries", () => {
    const entries = Array.from({ length: 2 }, (_, i) => ({
      id: `inbox-concurrent-${i}`,
      receivedAt: new Date(Date.now() + i * 10).toISOString(),
      rawText: `message ${i}`,
      processed: false,
    }));

    appendInboxEntry(entries[0]);
    appendInboxEntry(entries[1]);

    const inbox = readInbox();
    expect(inbox).toHaveLength(2);
    expect(inbox[0]?.id).toBe("inbox-concurrent-0");
    expect(inbox[1]?.id).toBe("inbox-concurrent-1");
  });

  it("ten rapid sequential appends all appear in final read", () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({
      id: `inbox-seq-${i}`,
      receivedAt: new Date(Date.now() + i * 5).toISOString(),
      rawText: `sequential message ${i}`,
      processed: false,
    }));

    for (const entry of entries) {
      appendInboxEntry(entry);
    }

    const inbox = readInbox();
    expect(inbox).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(inbox[i]?.id).toBe(`inbox-seq-${i}`);
    }
  });

  it("mixing writes and appends preserves all data", () => {
    const first: InboxEntry = {
      id: "inbox-1",
      receivedAt: "2026-06-04T09:00:00.000Z",
      rawText: "first batch",
      processed: false,
    };
    writeInbox([first]);

    const second: InboxEntry = {
      id: "inbox-2",
      receivedAt: "2026-06-04T09:01:00.000Z",
      rawText: "appended after write",
      processed: false,
    };
    appendInboxEntry(second);

    const inbox = readInbox();
    expect(inbox).toHaveLength(2);
    expect(inbox[0]?.id).toBe("inbox-1");
    expect(inbox[1]?.id).toBe("inbox-2");
  });
});

// ─── Edge case: empty string fields ───────────────────────────────────────────

describe("empty string field preservation", () => {
  beforeEach(clearTestData);

  it("Task with empty title and source round-trips correctly", () => {
    const task: Task = {
      id: "task-empty-fields",
      title: "",
      status: "todo",
      priority: 2,
      tags: [],
      source: "",
      createdAt: "2026-06-04T10:00:00.000Z",
    };
    writeTasks([task]);
    expect(readTasks()[0]).toEqual(task);
  });

  it("ActivityEntry with empty rawText preserves empty string", () => {
    const entry: ActivityEntry = {
      id: "act-empty",
      timestamp: "2026-06-04T14:00:00.000Z",
      type: "note",
      rawText: "",
      parsedFields: {},
    };
    writeActivityLog([entry]);
    expect(readActivityLog()[0]?.rawText).toBe("");
  });

  it("InboxEntry with empty rawText does not convert to null", () => {
    const entry: InboxEntry = {
      id: "inbox-empty",
      receivedAt: "2026-06-04T09:00:00.000Z",
      rawText: "",
      processed: false,
    };
    writeInbox([entry]);
    const read = readInbox()[0];
    expect(read?.rawText).toBe("");
    expect(read?.rawText).not.toBe(null);
  });

  it("CurrentState with empty lastObservation preserves empty string", () => {
    const state: CurrentState = {
      lastObservation: "",
      lastObservedAt: "2026-06-04T13:00:00.000Z",
      staleness: "fresh",
    };
    writeCurrentState(state);
    const read = readCurrentState();
    expect(read.lastObservation).toBe("");
  });

  it("Task with empty tags array preserves empty array", () => {
    const task: Task = {
      id: "task-empty-tags",
      title: "No tags",
      status: "todo",
      priority: 1,
      tags: [],
      source: "test",
      createdAt: "2026-06-04T10:00:00.000Z",
    };
    writeTasks([task]);
    const read = readTasks()[0];
    expect(read?.tags).toEqual([]);
  });
});

// ─── Edge case: large payload ─────────────────────────────────────────────────

describe("large payload handling", () => {
  beforeEach(clearTestData);

  it("writes and reads 1000 ActivityEntries without data loss", () => {
    const entries: ActivityEntry[] = Array.from({ length: 1000 }, (_, i) => ({
      id: `act-${i}`,
      timestamp: new Date(Date.now() - i * 60000).toISOString(),
      type: "note",
      rawText: `Activity entry ${i}`,
      parsedFields: { index: String(i) },
    }));

    writeActivityLog(entries);
    const read = readActivityLog();

    expect(read).toHaveLength(1000);
    expect(read[0]?.id).toBe("act-0");
    expect(read[999]?.id).toBe("act-999");
    for (let i = 0; i < 1000; i++) {
      expect(read[i]?.id).toBe(`act-${i}`);
    }
  });

  it("writes 100 Tasks and reads them back in same order", () => {
    const tasks: Task[] = Array.from({ length: 100 }, (_, i) => ({
      id: `task-bulk-${i}`,
      title: `Task ${i}`,
      status: "todo",
      priority: (((i % 3) + 1) as 1 | 2 | 3),
      tags: [`tag-${i}`, `tag-${i + 1}`],
      source: `Bulk test message ${i}`,
      createdAt: new Date(Date.now() - i * 3600000).toISOString(),
    }));

    writeTasks(tasks);
    const read = readTasks();

    expect(read).toHaveLength(100);
    expect(read[0]?.title).toBe("Task 0");
    expect(read[99]?.title).toBe("Task 99");
  });

  it("appends 50 InboxEntries one at a time, all preserved", () => {
    for (let i = 0; i < 50; i++) {
      appendInboxEntry({
        id: `inbox-large-${i}`,
        receivedAt: new Date(Date.now() + i * 1000).toISOString(),
        rawText: `Message ${i}`,
        processed: i % 2 === 0,
      });
    }

    const inbox = readInbox();
    expect(inbox).toHaveLength(50);
    expect(inbox[0]?.id).toBe("inbox-large-0");
    expect(inbox[49]?.id).toBe("inbox-large-49");
  });
});

// ─── Edge case: currentState staleness logic ──────────────────────────────────

describe("staleness field computation", () => {
  beforeEach(clearTestData);

  it("state with lastObservedAt = now reads back as fresh", () => {
    const now = new Date().toISOString();
    const state: CurrentState = {
      lastObservation: "Just now",
      lastObservedAt: now,
      staleness: "fresh",
    };
    writeCurrentState(state);
    const read = readCurrentState();
    expect(read.staleness).toBe("fresh");
  });

  it("state with lastObservedAt = 13 hours ago reads back with staleness field", () => {
    const thirteenHoursAgo = new Date(Date.now() - 13 * 3600000).toISOString();
    const state: CurrentState = {
      lastObservation: "Long time ago",
      lastObservedAt: thirteenHoursAgo,
      staleness: "stale",
    };
    writeCurrentState(state);
    const read = readCurrentState();
    expect(read.staleness).toBe("stale");
  });

  it("state with staleness='unknown' round-trips correctly", () => {
    const state: CurrentState = {
      lastObservation: "Never observed",
      lastObservedAt: new Date(0).toISOString(),
      staleness: "unknown",
    };
    writeCurrentState(state);
    const read = readCurrentState();
    expect(read.staleness).toBe("unknown");
  });

  it("default state has staleness='unknown'", () => {
    const state = readCurrentState();
    expect(state.staleness).toBe("unknown");
  });

  it("all three staleness values are preserved on round-trip", () => {
    const values: Array<["fresh" | "stale" | "unknown", string]> = [
      ["fresh", "2026-06-04T13:00:00.000Z"],
      ["stale", "2026-06-01T13:00:00.000Z"],
      ["unknown", "1970-01-01T00:00:00.000Z"],
    ];

    for (const [staleness, timestamp] of values) {
      const state: CurrentState = {
        lastObservation: `State ${staleness}`,
        lastObservedAt: timestamp,
        staleness,
      };
      writeCurrentState(state);
      expect(readCurrentState().staleness).toBe(staleness);
    }
  });
});

// ─── Edge case: missing data directory ────────────────────────────────────────

describe("missing data directory recreation", () => {
  it("write creates data directory if it does not exist before write", () => {
    const task: Task = {
      id: "task-dir-create",
      title: "Trigger dir creation",
      status: "todo",
      priority: 1,
      tags: [],
      source: "test",
      createdAt: "2026-06-04T10:00:00.000Z",
    };

    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    expect(existsSync(TEST_DATA_DIR)).toBe(false);

    writeTasks([task]);

    expect(existsSync(TEST_DATA_DIR)).toBe(true);
    expect(readTasks()).toHaveLength(1);
  });

  it("appendInboxEntry creates directory if missing", () => {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    expect(existsSync(TEST_DATA_DIR)).toBe(false);

    appendInboxEntry({
      id: "inbox-dir-create",
      receivedAt: "2026-06-04T09:00:00.000Z",
      rawText: "trigger dir creation",
      processed: false,
    });

    expect(existsSync(TEST_DATA_DIR)).toBe(true);
    expect(readInbox()).toHaveLength(1);
  });

  it("multiple writes all succeed when starting with missing directory", () => {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });

    writeTasks([
      {
        id: "task-1",
        title: "First",
        status: "todo",
        priority: 1,
        tags: [],
        source: "test",
        createdAt: "2026-06-04T10:00:00.000Z",
      },
    ]);

    writeActivityLog([
      {
        id: "act-1",
        timestamp: "2026-06-04T14:00:00.000Z",
        type: "note",
        rawText: "First activity",
        parsedFields: {},
      },
    ]);

    writeCurrentState({
      lastObservation: "Initialized",
      lastObservedAt: "2026-06-04T10:00:00.000Z",
      staleness: "fresh",
    });

    expect(readTasks()).toHaveLength(1);
    expect(readActivityLog()).toHaveLength(1);
    expect(readCurrentState().lastObservation).toBe("Initialized");
  });
});

// ─── Edge case: PolicyConfig defaults ──────────────────────────────────────────

describe("PolicyConfig defaults", () => {
  beforeEach(clearTestData);

  it("readPolicy on missing file returns sensible defaults", () => {
    const policy = readPolicy();
    expect(policy.staleAfterHours).toBe(12);
    expect(policy.bufferMinutes).toBe(15);
    expect(policy.bufferMinutes).toBeGreaterThan(0);
    expect(policy.dailyCap).toBe(5);
    expect(policy.dailyCap).toBeGreaterThan(0);
    expect(policy.defaultPriority).toBe(2);
    expect(policy.allowedWindows).toEqual([]);
    expect(policy.blackoutWindows).toEqual([]);
  });

  it("default policy has all required fields", () => {
    const policy = readPolicy();
    expect(policy).toHaveProperty("staleAfterHours");
    expect(policy).toHaveProperty("bufferMinutes");
    expect(policy).toHaveProperty("dailyCap");
    expect(policy).toHaveProperty("defaultPriority");
    expect(policy).toHaveProperty("allowedWindows");
    expect(policy).toHaveProperty("blackoutWindows");
  });

  it("custom policy with all fields round-trips without modification", () => {
    const custom: PolicyConfig = {
      allowedWindows: [
        { start: "08:00", end: "20:00", days: [1, 2, 3, 4, 5] },
        { start: "10:00", end: "18:00", days: [0, 6] },
      ],
      blackoutWindows: [
        { start: "12:00", end: "13:00", days: [1, 2, 3, 4, 5] },
      ],
      bufferMinutes: 30,
      dailyCap: 10,
      staleAfterHours: 6,
      defaultPriority: 1,
    };
    writePolicy(custom);
    expect(readPolicy()).toEqual(custom);
  });

  it("default dailyCap is non-zero", () => {
    const policy = readPolicy();
    expect(policy.dailyCap).toBeGreaterThan(0);
  });

  it("default staleAfterHours is positive", () => {
    const policy = readPolicy();
    expect(policy.staleAfterHours).toBeGreaterThan(0);
  });
});

// ─── Cleanup ──────────────────────────────────────────────────────────────────

afterEach(clearTestData);
