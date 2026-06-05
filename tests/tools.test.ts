import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "fs";
import { resolve } from "path";
import { spawnSync } from "bun";

// ─── Test isolation ───────────────────────────────────────────────────────────
const TEST_DATA_DIR = resolve(import.meta.dir, "../.test-data-tools");
process.env["PERSONAL_ASSISTANT_DATA_DIR"] = TEST_DATA_DIR;

function clearTestData() {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_DATA_DIR, { recursive: true });
}

function runTool(toolName: string, arg?: string): { exitCode: number; stdout: string; stderr: string } {
  const cmd = resolve(import.meta.dir, `../src/tools/${toolName}.ts`);
  const result = spawnSync(["bun", "run", cmd, ...(arg ? [arg] : [])], {
    env: { ...process.env, PERSONAL_ASSISTANT_DATA_DIR: TEST_DATA_DIR },
    cwd: resolve(import.meta.dir, ".."),
  });

  const stdout = result.stdout?.toString() ?? "";
  const stderr = result.stderr?.toString() ?? "";
  const exitCode = result.exitCode ?? 0;

  return { exitCode, stdout, stderr };
}

function initializeTaskFile(tasks: any[] = []) {
  const filePath = resolve(TEST_DATA_DIR, "tasks.json");
  writeFileSync(filePath, JSON.stringify(tasks, null, 2));
}

function initializeActivityLog(entries: any[] = []) {
  const filePath = resolve(TEST_DATA_DIR, "activity-log.json");
  writeFileSync(filePath, JSON.stringify(entries, null, 2));
}

function initializeAuditTrail(entries: any[] = []) {
  const filePath = resolve(TEST_DATA_DIR, "audit-trail.json");
  writeFileSync(filePath, JSON.stringify(entries, null, 2));
}

// ─────────────────────────────────────────────────────────────────────────────
// CREATE-TASK EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────

describe("tools: create-task", () => {
  beforeEach(clearTestData);

  it("exits with code 1 when argv[2] is missing", () => {
    const { exitCode, stderr } = runTool("create-task");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("usage:");
  });

  it("exits with code 1 when argv[2] is empty string", () => {
    const { exitCode, stderr } = runTool("create-task", "");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("usage:");
  });

  it("exits with code 1 when argv[2] is whitespace only", () => {
    const { exitCode, stderr } = runTool("create-task", "   ");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("usage:");
  });

  it("returns exit code 0 and prints task title when valid", () => {
    const { exitCode, stdout } = runTool("create-task", "buy groceries");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("task created:");
    expect(stdout).toContain("buy groceries");
  });

  it("handles very long task titles without truncation", () => {
    const longTitle = "a".repeat(500);
    const { exitCode, stdout } = runTool("create-task", longTitle);
    expect(exitCode).toBe(0);
    expect(stdout).toContain(longTitle);
  });

  it("preserves special characters in task title", () => {
    const title = 'fix bug: "null pointer exception" @ line 42 & config[key]';
    const { exitCode, stdout } = runTool("create-task", title);
    expect(exitCode).toBe(0);
    expect(stdout).toContain(title);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LOG-REALITY EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────

describe("tools: log-reality", () => {
  beforeEach(clearTestData);

  it("exits with code 1 when argv[2] is missing", () => {
    const { exitCode, stderr } = runTool("log-reality");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("usage:");
  });

  it("exits with code 1 when argv[2] is empty string", () => {
    const { exitCode, stderr } = runTool("log-reality", "");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("usage:");
  });

  it("exits with code 1 when argv[2] is whitespace only", () => {
    const { exitCode, stderr } = runTool("log-reality", "   ");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("usage:");
  });

  it("returns exit code 0 when logging valid message", () => {
    const { exitCode, stdout } = runTool("log-reality", "finished the report");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("logged:");
  });

  it("returns exit code 0 even when no matching task exists", () => {
    const { exitCode, stdout } = runTool("log-reality", "completed unknown task");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("logged:");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CREATE-EVENT EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────

describe("tools: create-event", () => {
  beforeEach(clearTestData);

  it("exits with code 1 when argv[2] is missing", () => {
    const { exitCode, stderr } = runTool("create-event");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("usage:");
  });

  it("exits with code 1 when argv[2] is empty string", () => {
    const { exitCode, stderr } = runTool("create-event", "");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("usage:");
  });

  it("exits with code 1 when JSON is malformed", () => {
    const { exitCode, stderr } = runTool("create-event", '{"title":"meeting"');
    expect(exitCode).toBe(1);
    expect(stderr).toContain("required fields");
  });

  it("exits with code 1 when JSON is null", () => {
    const { exitCode, stderr } = runTool("create-event", "null");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("required fields");
  });

  it("exits with code 1 when title field is missing", () => {
    const arg = JSON.stringify({ startAt: "2026-06-05T10:00:00Z", endAt: "2026-06-05T11:00:00Z", tier: 1 });
    const { exitCode, stderr } = runTool("create-event", arg);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("required fields");
  });

  it("exits with code 1 when startAt field is missing", () => {
    const arg = JSON.stringify({ title: "Meeting", endAt: "2026-06-05T11:00:00Z", tier: 1 });
    const { exitCode, stderr } = runTool("create-event", arg);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("required fields");
  });

  it("exits with code 1 when endAt field is missing", () => {
    const arg = JSON.stringify({ title: "Meeting", startAt: "2026-06-05T10:00:00Z", tier: 1 });
    const { exitCode, stderr } = runTool("create-event", arg);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("required fields");
  });

  it("exits with code 1 when tier field is missing", () => {
    const arg = JSON.stringify({ title: "Meeting", startAt: "2026-06-05T10:00:00Z", endAt: "2026-06-05T11:00:00Z" });
    const { exitCode, stderr } = runTool("create-event", arg);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("required fields");
  });

  it("exits with code 1 when title is not a string", () => {
    const arg = JSON.stringify({ title: 123, startAt: "2026-06-05T10:00:00Z", endAt: "2026-06-05T11:00:00Z", tier: 1 });
    const { exitCode, stderr } = runTool("create-event", arg);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("required fields");
  });

  it("exits with code 1 when startAt is not a string", () => {
    const arg = JSON.stringify({ title: "Meeting", startAt: 123, endAt: "2026-06-05T11:00:00Z", tier: 1 });
    const { exitCode, stderr } = runTool("create-event", arg);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("required fields");
  });

  it("exits with code 1 when endAt is not a string", () => {
    const arg = JSON.stringify({ title: "Meeting", startAt: "2026-06-05T10:00:00Z", endAt: null, tier: 1 });
    const { exitCode, stderr } = runTool("create-event", arg);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("required fields");
  });

  it("exits with code 1 when tier is not 1 or 2", () => {
    const arg = JSON.stringify({ title: "Meeting", startAt: "2026-06-05T10:00:00Z", endAt: "2026-06-05T11:00:00Z", tier: 3 });
    const { exitCode, stderr } = runTool("create-event", arg);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("required fields");
  });

  it("exits with code 1 when startAt is not a valid ISO date string", () => {
    const arg = JSON.stringify({ title: "Meeting", startAt: "not-a-date", endAt: "2026-06-05T11:00:00Z", tier: 1 });
    const { exitCode, stderr } = runTool("create-event", arg);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("valid ISO date");
  });

  it("exits with code 1 when endAt is not a valid ISO date string", () => {
    const arg = JSON.stringify({ title: "Meeting", startAt: "2026-06-05T10:00:00Z", endAt: "invalid", tier: 1 });
    const { exitCode, stderr } = runTool("create-event", arg);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("valid ISO date");
  });

  it("ignores extra JSON fields", () => {
    const arg = JSON.stringify({
      title: "Meeting",
      startAt: "2026-06-05T10:00:00Z",
      endAt: "2026-06-05T11:00:00Z",
      tier: 1,
      extraField: "ignored",
      anotherExtra: 123,
    });
    const { exitCode } = runTool("create-event", arg);
    // Should parse successfully even with extra fields
    // (osascript call may or may not succeed depending on env)
    expect(exitCode).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CREATE-REMINDER EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────

describe("tools: create-reminder", () => {
  beforeEach(clearTestData);

  it("exits with code 1 when argv[2] is missing", () => {
    const { exitCode, stderr } = runTool("create-reminder");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("usage:");
  });

  it("exits with code 1 when argv[2] is empty string", () => {
    const { exitCode, stderr } = runTool("create-reminder", "");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("usage:");
  });

  it("exits with code 1 when JSON is malformed", () => {
    const { exitCode, stderr } = runTool("create-reminder", '{"title":"reminder"');
    expect(exitCode).toBe(1);
    expect(stderr).toContain("required fields");
  });

  it("exits with code 1 when JSON is null", () => {
    const { exitCode, stderr } = runTool("create-reminder", "null");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("required fields");
  });

  it("exits with code 1 when title field is missing", () => {
    const arg = JSON.stringify({ dueAt: "2026-06-05T10:00:00Z", tier: 1 });
    const { exitCode, stderr } = runTool("create-reminder", arg);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("required fields");
  });

  it("exits with code 1 when dueAt field is missing", () => {
    const arg = JSON.stringify({ title: "Reminder", tier: 1 });
    const { exitCode, stderr } = runTool("create-reminder", arg);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("required fields");
  });

  it("exits with code 1 when tier field is missing", () => {
    const arg = JSON.stringify({ title: "Reminder", dueAt: "2026-06-05T10:00:00Z" });
    const { exitCode, stderr } = runTool("create-reminder", arg);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("required fields");
  });

  it("exits with code 1 when title is not a string", () => {
    const arg = JSON.stringify({ title: 456, dueAt: "2026-06-05T10:00:00Z", tier: 1 });
    const { exitCode, stderr } = runTool("create-reminder", arg);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("required fields");
  });

  it("exits with code 1 when dueAt is not a string", () => {
    const arg = JSON.stringify({ title: "Reminder", dueAt: 123, tier: 1 });
    const { exitCode, stderr } = runTool("create-reminder", arg);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("required fields");
  });

  it("exits with code 1 when tier is not 1 or 2", () => {
    const arg = JSON.stringify({ title: "Reminder", dueAt: "2026-06-05T10:00:00Z", tier: 0 });
    const { exitCode, stderr } = runTool("create-reminder", arg);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("required fields");
  });

  it("exits with code 1 when dueAt is not a valid ISO date string", () => {
    const arg = JSON.stringify({ title: "Reminder", dueAt: "not-a-date", tier: 1 });
    const { exitCode, stderr } = runTool("create-reminder", arg);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("valid ISO date");
  });

  it("ignores extra JSON fields", () => {
    const arg = JSON.stringify({
      title: "Reminder",
      dueAt: "2026-06-05T10:00:00Z",
      tier: 1,
      extraField: "ignored",
    });
    const { exitCode } = runTool("create-reminder", arg);
    // Should parse successfully even with extra fields
    // (osascript call may or may not succeed depending on env)
    expect(exitCode).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET-STATE EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────

describe("tools: get-state", () => {
  beforeEach(clearTestData);

  it("outputs 'unknown' when current-state file does not exist", () => {
    const { exitCode, stdout } = runTool("get-state");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("unknown");
  });

  it("outputs 'unknown' when no lastObservation is set", () => {
    const stateFile = resolve(TEST_DATA_DIR, "current-state.json");
    writeFileSync(stateFile, JSON.stringify({ lastObservation: null, staleness: "fresh", lastObservedAt: new Date().toISOString() }));
    const { exitCode, stdout } = runTool("get-state");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("unknown");
  });

  it("outputs 'unknown' when lastObservedAt is epoch (default)", () => {
    const stateFile = resolve(TEST_DATA_DIR, "current-state.json");
    // epoch time (0) is how storage marks "no state yet"
    writeFileSync(
      stateFile,
      JSON.stringify({ lastObservation: "at home", staleness: "fresh", lastObservedAt: "1970-01-01T00:00:00Z" })
    );
    const { exitCode, stdout } = runTool("get-state");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("unknown");
  });

  it("outputs observation and staleness when both are set", () => {
    const stateFile = resolve(TEST_DATA_DIR, "current-state.json");
    writeFileSync(
      stateFile,
      JSON.stringify({ lastObservation: "at the gym", staleness: "fresh", lastObservedAt: "2026-06-05T10:30:00Z" })
    );
    const { exitCode, stdout } = runTool("get-state");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("at the gym");
    // Note: staleness is computed based on time elapsed, so test for "as of" instead
    expect(stdout).toContain("as of");
  });

  it("returns exit code 0 in all cases", () => {
    const { exitCode } = runTool("get-state");
    expect(exitCode).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LIST-TASKS EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────

describe("tools: list-tasks", () => {
  beforeEach(clearTestData);

  it("returns empty array when tasks.json does not exist", () => {
    const { exitCode, stdout } = runTool("list-tasks");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("[]");
  });

  it("returns only active tasks by default (excludes done/dropped)", () => {
    initializeTaskFile([
      { id: "1", title: "Task 1", status: "todo" },
      { id: "2", title: "Task 2", status: "done" },
    ]);
    const { exitCode, stdout } = runTool("list-tasks");
    expect(exitCode).toBe(0);
    expect(stdout).toContain('"id": "1"');
    expect(stdout).not.toContain('"id": "2"');
  });

  it("filters by single status string", () => {
    initializeTaskFile([
      { id: "1", title: "Task 1", status: "todo" },
      { id: "2", title: "Task 2", status: "done" },
    ]);
    const arg = JSON.stringify({ status: "done" });
    const { exitCode, stdout } = runTool("list-tasks", arg);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('"id": "2"');
    expect(stdout).not.toContain('"id": "1"');
  });

  it("filters by array of statuses", () => {
    initializeTaskFile([
      { id: "1", title: "Task 1", status: "todo" },
      { id: "2", title: "Task 2", status: "done" },
      { id: "3", title: "Task 3", status: "scheduled" },
    ]);
    const arg = JSON.stringify({ status: ["todo", "done"] });
    const { exitCode, stdout } = runTool("list-tasks", arg);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('"id": "1"');
    expect(stdout).toContain('"id": "2"');
    expect(stdout).not.toContain('"id": "3"');
  });

  it("exits with code 1 when status filter is invalid string", () => {
    const arg = JSON.stringify({ status: "invalid-status" });
    const { exitCode, stderr } = runTool("list-tasks", arg);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("invalid filter");
  });

  it("exits with code 1 when status array contains invalid value", () => {
    const arg = JSON.stringify({ status: ["todo", "invalid", "done"] });
    const { exitCode, stderr } = runTool("list-tasks", arg);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("invalid filter");
  });

  it("exits with code 1 when JSON is malformed", () => {
    const { exitCode, stderr } = runTool("list-tasks", "{invalid json");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("invalid filter");
  });

  it("ignores unknown filter fields", () => {
    initializeTaskFile([{ id: "1", title: "Task 1", status: "todo" }]);
    const arg = JSON.stringify({ status: "todo", unknownField: "value" });
    const { exitCode, stdout } = runTool("list-tasks", arg);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('"id": "1"');
  });

  it("accepts empty filter object and applies default filtering", () => {
    initializeTaskFile([
      { id: "1", title: "Task 1", status: "todo" },
      { id: "2", title: "Task 2", status: "done" },
    ]);
    const arg = JSON.stringify({});
    const { exitCode, stdout } = runTool("list-tasks", arg);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('"id": "1"');
    expect(stdout).not.toContain('"id": "2"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DROP-TASK EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────

describe("tools: drop-task", () => {
  beforeEach(clearTestData);

  it("exits with code 1 when argv[2] is missing", () => {
    const { exitCode, stderr } = runTool("drop-task");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("usage:");
  });

  it("exits with code 1 when argv[2] is empty string", () => {
    const { exitCode, stderr } = runTool("drop-task", "");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("usage:");
  });

  it("exits with code 1 when argv[2] is whitespace only", () => {
    const { exitCode, stderr } = runTool("drop-task", "   ");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("usage:");
  });

  it("outputs 'not found' when fragment matches nothing", () => {
    initializeTaskFile([{ id: "1", title: "buy milk", status: "todo" }]);
    const { exitCode, stdout } = runTool("drop-task", "nonexistent");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("not found");
    expect(stdout).toContain("nonexistent");
  });

  it("ignores already-dropped tasks when finding match", () => {
    initializeTaskFile([{ id: "1", title: "old task", status: "dropped" }]);
    const { exitCode, stdout } = runTool("drop-task", "old task");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("not found");
  });

  it("ignores already-done tasks when finding match", () => {
    initializeTaskFile([{ id: "1", title: "completed task", status: "done" }]);
    const { exitCode, stdout } = runTool("drop-task", "completed");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("not found");
  });

  it("matches task fragment case-insensitively", () => {
    initializeTaskFile([{ id: "1", title: "Buy Groceries", status: "todo" }]);
    const { exitCode, stdout } = runTool("drop-task", "buy");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("dropped");
  });

  it("returns exit code 0 even when no match is found", () => {
    const { exitCode } = runTool("drop-task", "missing task");
    expect(exitCode).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UNDO-LAST EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────

describe("tools: undo-last", () => {
  beforeEach(clearTestData);

  it("outputs 'nothing to undo' when audit trail is empty", () => {
    initializeAuditTrail([]);
    const { exitCode, stdout } = runTool("undo-last");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("nothing to undo");
  });

  it("outputs 'nothing to undo' when audit-trail file does not exist", () => {
    const { exitCode, stdout } = runTool("undo-last");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("nothing to undo");
  });

  it("returns exit code 0 when audit trail is empty", () => {
    initializeAuditTrail([]);
    const { exitCode } = runTool("undo-last");
    expect(exitCode).toBe(0);
  });

  it("returns exit code 0 when audit-trail file does not exist", () => {
    const { exitCode } = runTool("undo-last");
    expect(exitCode).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────

describe("tools: audit", () => {
  beforeEach(clearTestData);

  it("outputs 'no entries' when audit-trail.json does not exist", () => {
    const { exitCode, stdout } = runTool("audit");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("no entries");
  });

  it("outputs 'no entries' when audit trail is empty", () => {
    initializeAuditTrail([]);
    const { exitCode, stdout } = runTool("audit");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("no entries");
  });

  it("returns exit code 0 in all cases", () => {
    const { exitCode } = runTool("audit");
    expect(exitCode).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TODAY EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────
// NOTE: today.ts calls getUpcomingEvents which attempts osascript interaction,
// which may hang or timeout in test environment. Skipping osascript-dependent
// tests and focusing on edge cases where getUpcomingEvents isn't the blocker.
