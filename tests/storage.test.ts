import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from "fs";
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
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
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

// ─── Cleanup ──────────────────────────────────────────────────────────────────

afterEach(clearTestData);
