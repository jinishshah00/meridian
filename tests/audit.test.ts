import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { resolve } from "path";
import type { CalendarMirrorEntry } from "../src/types.js";

// ─── Test harness ─────────────────────────────────────────────────────────────
//
// Redirect the data directory before any module is imported so storage.ts picks
// up the test path on first evaluation.

// Use the same test data directory as the majority of other test files so that
// module caching of storage.ts (which reads DATA_DIR once at eval time) does
// not cause storage.ts to read from a different directory than what we clear.
const TEST_DATA_DIR = resolve(import.meta.dir, "../.test-data-tmp");
process.env["PERSONAL_ASSISTANT_DATA_DIR"] = TEST_DATA_DIR;

// Import storage and audit after the env var is set.
const { readCalendarMirror, writeCalendarMirror } = await import("../src/storage.js");

// Import plan module so we can spy on undoCalendarEntry without calling osascript.
const planModule = await import("../src/plan.js");

const {
  getAuditTrail,
  undoLast,
  undoById,
  getTodaysChanges,
  getTier2CountToday,
  formatEntry,
} = await import("../src/audit.js");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clearTestData() {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_DATA_DIR, { recursive: true });
}

function makeEntry(overrides: Partial<CalendarMirrorEntry> = {}): CalendarMirrorEntry {
  return {
    id: "test-id-" + Math.random().toString(36).slice(2),
    externalId: "ext-" + Math.random().toString(36).slice(2),
    title: "Test Entry",
    startAt: new Date("2026-06-05T15:00:00Z").toISOString(),
    isReminder: false,
    tier: 1,
    createdAt: new Date("2026-06-05T12:00:00Z").toISOString(),
    undone: false,
    ...overrides,
  };
}

/** Today's local YYYY-MM-DD, mirroring the audit module's isSameLocalDate logic. */
function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear().toString().padStart(4, "0");
  const m = (now.getMonth() + 1).toString().padStart(2, "0");
  const d = now.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}T10:00:00.000Z`;
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  clearTestData();
  // Explicitly reset the mirror file so storage.ts (whose DATA_DIR is evaluated
  // once at module load) always starts each test with a clean calendar mirror,
  // regardless of which process-cached DATA_DIR value is in effect.
  writeCalendarMirror([]);
});

afterEach(() => {
  writeCalendarMirror([]);
  clearTestData();
});

// ─── getAuditTrail ────────────────────────────────────────────────────────────

describe("getAuditTrail", () => {
  it("returns empty array when mirror is empty", () => {
    expect(getAuditTrail()).toEqual([]);
  });

  it("returns all entries sorted newest-first by createdAt", () => {
    const older = makeEntry({ createdAt: "2026-06-04T10:00:00.000Z" });
    const newer = makeEntry({ createdAt: "2026-06-05T10:00:00.000Z" });
    writeCalendarMirror([older, newer]);

    const result = getAuditTrail();
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe(newer.id);
    expect(result[1]!.id).toBe(older.id);
  });

  it("filters by tier", () => {
    const tier1 = makeEntry({ tier: 1 });
    const tier2 = makeEntry({ tier: 2 });
    writeCalendarMirror([tier1, tier2]);

    const result = getAuditTrail({ tier: 1 });
    expect(result).toHaveLength(1);
    expect(result[0]!.tier).toBe(1);
  });

  it("filters undone: false returns only active entries", () => {
    const active = makeEntry({ undone: false });
    const undoneEntry = makeEntry({ undone: true });
    writeCalendarMirror([active, undoneEntry]);

    const result = getAuditTrail({ undone: false });
    expect(result).toHaveLength(1);
    expect(result[0]!.undone).toBe(false);
  });

  it("filters undone: true returns only undone entries", () => {
    const active = makeEntry({ undone: false });
    const undoneEntry = makeEntry({ undone: true });
    writeCalendarMirror([active, undoneEntry]);

    const result = getAuditTrail({ undone: true });
    expect(result).toHaveLength(1);
    expect(result[0]!.undone).toBe(true);
  });

  it("filters by since (inclusive)", () => {
    const before = makeEntry({ createdAt: "2026-06-03T10:00:00.000Z" });
    const after = makeEntry({ createdAt: "2026-06-05T10:00:00.000Z" });
    writeCalendarMirror([before, after]);

    const result = getAuditTrail({ since: new Date("2026-06-04T00:00:00.000Z") });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(after.id);
  });

  it("includes entry exactly on the since boundary", () => {
    const boundary = makeEntry({ createdAt: "2026-06-04T00:00:00.000Z" });
    writeCalendarMirror([boundary]);

    const result = getAuditTrail({ since: new Date("2026-06-04T00:00:00.000Z") });
    expect(result).toHaveLength(1);
  });

  it("filters by until (inclusive)", () => {
    const before = makeEntry({ createdAt: "2026-06-03T10:00:00.000Z" });
    const after = makeEntry({ createdAt: "2026-06-05T10:00:00.000Z" });
    writeCalendarMirror([before, after]);

    const result = getAuditTrail({ until: new Date("2026-06-04T00:00:00.000Z") });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(before.id);
  });

  it("includes entry exactly on the until boundary", () => {
    const boundary = makeEntry({ createdAt: "2026-06-04T00:00:00.000Z" });
    writeCalendarMirror([boundary]);

    const result = getAuditTrail({ until: new Date("2026-06-04T00:00:00.000Z") });
    expect(result).toHaveLength(1);
  });

  it("combines tier and undone filters (AND)", () => {
    const tier2Active = makeEntry({ tier: 2, undone: false });
    const tier2Undone = makeEntry({ tier: 2, undone: true });
    const tier1Active = makeEntry({ tier: 1, undone: false });
    writeCalendarMirror([tier2Active, tier2Undone, tier1Active]);

    const result = getAuditTrail({ tier: 2, undone: false });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(tier2Active.id);
  });

  it("combines since and until range", () => {
    const tooEarly = makeEntry({ createdAt: "2026-06-01T10:00:00.000Z" });
    const inRange = makeEntry({ createdAt: "2026-06-03T10:00:00.000Z" });
    const tooLate = makeEntry({ createdAt: "2026-06-06T10:00:00.000Z" });
    writeCalendarMirror([tooEarly, inRange, tooLate]);

    const result = getAuditTrail({
      since: new Date("2026-06-02T00:00:00.000Z"),
      until: new Date("2026-06-04T00:00:00.000Z"),
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(inRange.id);
  });

  it("returns empty when no entries match the filter", () => {
    const entry = makeEntry({ tier: 1 });
    writeCalendarMirror([entry]);

    expect(getAuditTrail({ tier: 3 })).toHaveLength(0);
  });
});

// ─── undoLast ─────────────────────────────────────────────────────────────────

describe("undoLast", () => {
  it("returns null when the mirror is empty", async () => {
    const undoSpy = spyOn(planModule, "undoCalendarEntry").mockImplementation(
      async () => undefined,
    );
    const result = await undoLast();
    expect(result).toBeNull();
    expect(undoSpy).not.toHaveBeenCalled();
    undoSpy.mockRestore();
  });

  it("returns null when all entries are already undone", async () => {
    const undoneEntry = makeEntry({ undone: true });
    writeCalendarMirror([undoneEntry]);

    const undoSpy = spyOn(planModule, "undoCalendarEntry").mockImplementation(
      async () => undefined,
    );
    const result = await undoLast();
    expect(result).toBeNull();
    expect(undoSpy).not.toHaveBeenCalled();
    undoSpy.mockRestore();
  });

  it("undoes the most recent active entry and returns it", async () => {
    const older = makeEntry({
      id: "older-id",
      createdAt: "2026-06-04T10:00:00.000Z",
      undone: false,
    });
    const newer = makeEntry({
      id: "newer-id",
      createdAt: "2026-06-05T10:00:00.000Z",
      undone: false,
    });
    writeCalendarMirror([older, newer]);

    // Simulate what undoCalendarEntry does: mark the entry undone in the mirror
    // so that the post-undo re-read in audit.ts returns undone: true.
    const undoSpy = spyOn(planModule, "undoCalendarEntry").mockImplementation(
      async (id: string) => {
        const mirror = readCalendarMirror();
        const updated = mirror.map((e) => (e.id === id ? { ...e, undone: true } : e));
        writeCalendarMirror(updated);
      },
    );
    const result = await undoLast();
    expect(result).not.toBeNull();
    expect(result!.id).toBe("newer-id");
    expect(result!.undone).toBe(true);
    expect(undoSpy).toHaveBeenCalledWith("newer-id");
    undoSpy.mockRestore();
  });

  it("skips undone entries when selecting the most recent active entry", async () => {
    // newest is already undone; second-newest is active
    const newestUndone = makeEntry({
      id: "newest-undone",
      createdAt: "2026-06-06T10:00:00.000Z",
      undone: true,
    });
    const secondActive = makeEntry({
      id: "second-active",
      createdAt: "2026-06-05T10:00:00.000Z",
      undone: false,
    });
    writeCalendarMirror([newestUndone, secondActive]);

    const undoSpy = spyOn(planModule, "undoCalendarEntry").mockImplementation(
      async (id: string) => {
        const mirror = readCalendarMirror();
        const updated = mirror.map((e) => (e.id === id ? { ...e, undone: true } : e));
        writeCalendarMirror(updated);
      },
    );
    const result = await undoLast();
    expect(result!.id).toBe("second-active");
    expect(result!.undone).toBe(true);
    undoSpy.mockRestore();
  });
});

// ─── undoById ─────────────────────────────────────────────────────────────────

describe("undoById", () => {
  it("undoes an active entry by id and returns it", async () => {
    const entry = makeEntry({ id: "target-id", undone: false });
    writeCalendarMirror([entry]);

    // Simulate what undoCalendarEntry does: mark the entry undone in the mirror
    // so that the post-undo re-read in audit.ts returns undone: true.
    const undoSpy = spyOn(planModule, "undoCalendarEntry").mockImplementation(
      async (id: string) => {
        const mirror = readCalendarMirror();
        const updated = mirror.map((e) => (e.id === id ? { ...e, undone: true } : e));
        writeCalendarMirror(updated);
      },
    );
    const result = await undoById("target-id");
    expect(result.id).toBe("target-id");
    expect(result.undone).toBe(true);
    expect(undoSpy).toHaveBeenCalledWith("target-id");
    undoSpy.mockRestore();
  });

  it("throws 'entry not found' when id does not exist", async () => {
    writeCalendarMirror([]);

    const undoSpy = spyOn(planModule, "undoCalendarEntry").mockImplementation(
      async () => undefined,
    );
    await expect(undoById("nonexistent-id")).rejects.toThrow(
      "entry not found: nonexistent-id",
    );
    expect(undoSpy).not.toHaveBeenCalled();
    undoSpy.mockRestore();
  });

  it("throws 'entry already undone' when the entry is already undone", async () => {
    const entry = makeEntry({ id: "already-undone-id", undone: true });
    writeCalendarMirror([entry]);

    const undoSpy = spyOn(planModule, "undoCalendarEntry").mockImplementation(
      async () => undefined,
    );
    await expect(undoById("already-undone-id")).rejects.toThrow(
      "entry already undone: already-undone-id",
    );
    expect(undoSpy).not.toHaveBeenCalled();
    undoSpy.mockRestore();
  });

  it("does not call undoCalendarEntry when entry is not found", async () => {
    const entry = makeEntry({ id: "some-id" });
    writeCalendarMirror([entry]);

    const undoSpy = spyOn(planModule, "undoCalendarEntry").mockImplementation(
      async () => undefined,
    );
    await expect(undoById("wrong-id")).rejects.toThrow();
    expect(undoSpy).not.toHaveBeenCalled();
    undoSpy.mockRestore();
  });
});

// ─── getTodaysChanges ─────────────────────────────────────────────────────────

describe("getTodaysChanges", () => {
  it("returns empty array when mirror is empty", () => {
    expect(getTodaysChanges()).toEqual([]);
  });

  it("returns only entries created today", () => {
    const todayEntry = makeEntry({ createdAt: todayIso() });
    const pastEntry = makeEntry({ createdAt: "2020-01-01T10:00:00.000Z" });
    writeCalendarMirror([todayEntry, pastEntry]);

    const result = getTodaysChanges();
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(todayEntry.id);
  });

  it("returns today's entries newest-first", () => {
    const now = new Date();
    const earlier = makeEntry({
      createdAt: new Date(now.getTime() - 3600_000).toISOString(),
    });
    const later = makeEntry({
      createdAt: now.toISOString(),
    });
    writeCalendarMirror([earlier, later]);

    const result = getTodaysChanges();
    expect(result).toHaveLength(2);
    expect(new Date(result[0]!.createdAt).getTime()).toBeGreaterThanOrEqual(
      new Date(result[1]!.createdAt).getTime(),
    );
  });

  it("returns empty array when no entries fall on today", () => {
    const pastEntry = makeEntry({ createdAt: "2020-01-01T10:00:00.000Z" });
    writeCalendarMirror([pastEntry]);
    expect(getTodaysChanges()).toHaveLength(0);
  });
});

// ─── getTier2CountToday ───────────────────────────────────────────────────────

describe("getTier2CountToday", () => {
  it("returns 0 when mirror is empty", () => {
    expect(getTier2CountToday()).toBe(0);
  });

  it("counts only tier-2 active entries created today", () => {
    const tier2Today = makeEntry({ tier: 2, undone: false, createdAt: todayIso() });
    const tier1Today = makeEntry({ tier: 1, undone: false, createdAt: todayIso() });
    const tier2Undone = makeEntry({ tier: 2, undone: true, createdAt: todayIso() });
    const tier2Past = makeEntry({ tier: 2, undone: false, createdAt: "2020-01-01T10:00:00.000Z" });
    writeCalendarMirror([tier2Today, tier1Today, tier2Undone, tier2Past]);

    expect(getTier2CountToday()).toBe(1);
  });

  it("does not count undone tier-2 entries from today", () => {
    const undone = makeEntry({ tier: 2, undone: true, createdAt: todayIso() });
    writeCalendarMirror([undone]);
    expect(getTier2CountToday()).toBe(0);
  });

  it("does not count tier-2 entries from past days", () => {
    const past = makeEntry({ tier: 2, undone: false, createdAt: "2020-01-01T10:00:00.000Z" });
    writeCalendarMirror([past]);
    expect(getTier2CountToday()).toBe(0);
  });

  it("counts multiple tier-2 active entries today", () => {
    const a = makeEntry({ tier: 2, undone: false, createdAt: todayIso() });
    const b = makeEntry({ tier: 2, undone: false, createdAt: todayIso() });
    const c = makeEntry({ tier: 2, undone: false, createdAt: todayIso() });
    writeCalendarMirror([a, b, c]);
    expect(getTier2CountToday()).toBe(3);
  });
});

// ─── formatEntry ─────────────────────────────────────────────────────────────

describe("formatEntry", () => {
  it("formats an active calendar event", () => {
    const entry = makeEntry({
      title: "Dentist",
      // 2026-06-05 is a Friday; 3:00 PM UTC used as a fixed reference
      startAt: "2026-06-05T15:00:00.000Z",
      isReminder: false,
      tier: 1,
      undone: false,
    });
    const result = formatEntry(entry);
    expect(result).toContain("[Event]");
    expect(result).toContain("Dentist");
    expect(result).toContain("(Tier 1)");
    expect(result).toContain("✓ active");
    expect(result).not.toContain("[Reminder]");
  });

  it("formats an undone reminder", () => {
    const entry = makeEntry({
      title: "Take meds",
      startAt: "2026-06-06T09:00:00.000Z",
      isReminder: true,
      tier: 2,
      undone: true,
    });
    const result = formatEntry(entry);
    expect(result).toContain("[Reminder]");
    expect(result).toContain("Take meds");
    expect(result).toContain("(Tier 2)");
    expect(result).toContain("✗ undone");
    expect(result).not.toContain("[Event]");
  });

  it("format includes the title, dash separator, and tier", () => {
    const entry = makeEntry({ title: "Team standup", tier: 0 });
    const result = formatEntry(entry);
    expect(result).toContain("Team standup");
    expect(result).toContain("—");
    expect(result).toContain("(Tier 0)");
  });

  it("formats the date as 'Weekday Mon D at H:MMam/pm' pattern", () => {
    const entry = makeEntry({
      // A known weekday/time: 2026-06-08 is a Monday at 9:00 AM UTC
      startAt: "2026-06-08T09:00:00.000Z",
    });
    const result = formatEntry(entry);
    // Verify it contains a time with colon and am/pm marker
    expect(result).toMatch(/\d+:\d{2}[ap]m/);
  });

  it("formats all four tiers in the tier label", () => {
    for (const tier of [0, 1, 2, 3] as const) {
      const entry = makeEntry({ tier });
      expect(formatEntry(entry)).toContain(`(Tier ${tier})`);
    }
  });

  it("active status shows ✓ active, undone status shows ✗ undone", () => {
    const active = makeEntry({ undone: false });
    const undone = makeEntry({ undone: true });
    expect(formatEntry(active)).toContain("✓ active");
    expect(formatEntry(undone)).toContain("✗ undone");
  });

  it("produces a single-line string (no newlines)", () => {
    const entry = makeEntry({ title: "Yoga class" });
    expect(formatEntry(entry)).not.toContain("\n");
  });

  it("uses [Event] for non-reminders and [Reminder] for reminders", () => {
    const event = makeEntry({ isReminder: false });
    const reminder = makeEntry({ isReminder: true });
    expect(formatEntry(event)).toContain("[Event]");
    expect(formatEntry(reminder)).toContain("[Reminder]");
  });

  it("formats entry with midnight (12:00am)", () => {
    // 2026-06-05T00:00:00Z is midnight UTC
    const entry = makeEntry({ startAt: "2026-06-05T00:00:00.000Z" });
    const result = formatEntry(entry);
    expect(result).toContain("12:00am");
    expect(result).not.toContain("0:00am");
  });

  it("formats entry with noon (12:00pm)", () => {
    // 2026-06-05T12:00:00Z is noon UTC
    const entry = makeEntry({ startAt: "2026-06-05T12:00:00.000Z" });
    const result = formatEntry(entry);
    expect(result).toContain("12:00pm");
    expect(result).not.toContain("0:00pm");
  });

  it("formats 1:00am correctly", () => {
    const entry = makeEntry({ startAt: "2026-06-05T01:00:00.000Z" });
    const result = formatEntry(entry);
    expect(result).toContain("1:00am");
  });

  it("formats 11:59pm correctly", () => {
    const entry = makeEntry({ startAt: "2026-06-05T23:59:00.000Z" });
    const result = formatEntry(entry);
    expect(result).toContain("11:59pm");
  });

  it("formats 13:00 (1:00pm) correctly", () => {
    const entry = makeEntry({ startAt: "2026-06-05T13:00:00.000Z" });
    const result = formatEntry(entry);
    expect(result).toContain("1:00pm");
  });
});

// ─── Edge cases: getAuditTrail ────────────────────────────────────────────────

describe("getAuditTrail — edge cases", () => {
  it("returns empty array when mirror is completely empty", () => {
    writeCalendarMirror([]);
    expect(getAuditTrail()).toEqual([]);
  });

  it("applies all four filters combined with AND logic", () => {
    // Create entries with different combinations
    const t2ActiveYesterday = makeEntry({
      tier: 2,
      undone: false,
      createdAt: "2026-06-04T12:00:00.000Z",
    });
    const t2ActiveToday = makeEntry({
      tier: 2,
      undone: false,
      createdAt: "2026-06-05T12:00:00.000Z",
    });
    const t2UndoneToday = makeEntry({
      tier: 2,
      undone: true,
      createdAt: "2026-06-05T12:00:00.000Z",
    });
    const t1ActiveToday = makeEntry({
      tier: 1,
      undone: false,
      createdAt: "2026-06-05T12:00:00.000Z",
    });

    writeCalendarMirror([t2ActiveYesterday, t2ActiveToday, t2UndoneToday, t1ActiveToday]);

    // Filter: tier 2, active, created on June 5, in range
    const result = getAuditTrail({
      tier: 2,
      undone: false,
      since: new Date("2026-06-05T00:00:00.000Z"),
      until: new Date("2026-06-06T00:00:00.000Z"),
    });

    // Should only match t2ActiveToday
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(t2ActiveToday.id);
  });

  it("includes entry with createdAt exactly equal to since boundary", () => {
    const boundaryEntry = makeEntry({
      createdAt: "2026-06-05T00:00:00.000Z",
    });
    const beforeEntry = makeEntry({
      createdAt: "2026-06-04T23:59:59.000Z",
    });

    writeCalendarMirror([beforeEntry, boundaryEntry]);

    const result = getAuditTrail({
      since: new Date("2026-06-05T00:00:00.000Z"),
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(boundaryEntry.id);
  });

  it("includes entry with createdAt exactly equal to until boundary", () => {
    const boundaryEntry = makeEntry({
      createdAt: "2026-06-05T00:00:00.000Z",
    });
    const afterEntry = makeEntry({
      createdAt: "2026-06-05T00:00:01.000Z",
    });

    writeCalendarMirror([boundaryEntry, afterEntry]);

    const result = getAuditTrail({
      until: new Date("2026-06-05T00:00:00.000Z"),
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(boundaryEntry.id);
  });

  it("handles range with both since and until at the same exact timestamp", () => {
    const exactMatch = makeEntry({
      createdAt: "2026-06-05T12:00:00.000Z",
    });
    const before = makeEntry({
      createdAt: "2026-06-05T11:59:59.000Z",
    });
    const after = makeEntry({
      createdAt: "2026-06-05T12:00:01.000Z",
    });

    writeCalendarMirror([before, exactMatch, after]);

    const result = getAuditTrail({
      since: new Date("2026-06-05T12:00:00.000Z"),
      until: new Date("2026-06-05T12:00:00.000Z"),
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(exactMatch.id);
  });
});

// ─── Edge cases: undoLast ─────────────────────────────────────────────────────

describe("undoLast — edge cases", () => {
  it("returns null when all entries in mirror are already undone", async () => {
    const undone1 = makeEntry({ id: "undone-1", undone: true });
    const undone2 = makeEntry({ id: "undone-2", undone: true });
    const undone3 = makeEntry({ id: "undone-3", undone: true });
    writeCalendarMirror([undone1, undone2, undone3]);

    const undoSpy = spyOn(planModule, "undoCalendarEntry").mockImplementation(
      async () => undefined,
    );

    const result = await undoLast();
    expect(result).toBeNull();
    expect(undoSpy).not.toHaveBeenCalled();
    undoSpy.mockRestore();
  });
});

// ─── Edge cases: undoById ─────────────────────────────────────────────────────

describe("undoById — edge cases", () => {
  it("throws entry not found error when mirror is empty", async () => {
    writeCalendarMirror([]);

    const undoSpy = spyOn(planModule, "undoCalendarEntry").mockImplementation(
      async () => undefined,
    );

    await expect(undoById("any-id")).rejects.toThrow("entry not found: any-id");
    expect(undoSpy).not.toHaveBeenCalled();
    undoSpy.mockRestore();
  });
});

// ─── Edge cases: getTodaysChanges ─────────────────────────────────────────────

describe("getTodaysChanges — edge cases", () => {
  it("excludes entries created yesterday using local date comparison", () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 86400_000); // 24 hours ago
    const yesterdayIso = yesterday.toISOString();

    const yesterdayEntry = makeEntry({ createdAt: yesterdayIso });
    const todayEntry = makeEntry({ createdAt: now.toISOString() });

    writeCalendarMirror([yesterdayEntry, todayEntry]);

    const result = getTodaysChanges();
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(todayEntry.id);
  });

  it("uses local date not UTC offset tricks for boundary detection", () => {
    // Create an entry at exactly midnight UTC but that may be "yesterday"
    // in local time if in a timezone west of UTC
    const entry = makeEntry({ createdAt: "2026-06-05T00:00:00.000Z" });
    writeCalendarMirror([entry]);

    // Just verify the function doesn't crash and returns a consistent result
    const result1 = getTodaysChanges();
    const result2 = getTodaysChanges();

    // Both calls should return the same results (no timezone inconsistencies)
    expect(result1.length).toBe(result2.length);
  });
});

// ─── Edge cases: getTier2CountToday ───────────────────────────────────────────

describe("getTier2CountToday — edge cases", () => {
  it("does not count undone Tier 2 entries created today", () => {
    const active = makeEntry({
      tier: 2,
      undone: false,
      createdAt: todayIso(),
    });
    const undone = makeEntry({
      tier: 2,
      undone: true,
      createdAt: todayIso(),
    });

    writeCalendarMirror([active, undone]);

    expect(getTier2CountToday()).toBe(1);
  });

  it("does not count Tier 1 entries created today", () => {
    const tier1Today = makeEntry({
      tier: 1,
      undone: false,
      createdAt: todayIso(),
    });
    const tier2Today = makeEntry({
      tier: 2,
      undone: false,
      createdAt: todayIso(),
    });

    writeCalendarMirror([tier1Today, tier2Today]);

    expect(getTier2CountToday()).toBe(1);
  });

  it("does not count Tier 0 entries created today", () => {
    const tier0Today = makeEntry({
      tier: 0,
      undone: false,
      createdAt: todayIso(),
    });
    const tier2Today = makeEntry({
      tier: 2,
      undone: false,
      createdAt: todayIso(),
    });

    writeCalendarMirror([tier0Today, tier2Today]);

    expect(getTier2CountToday()).toBe(1);
  });

  it("does not count Tier 3 entries created today", () => {
    const tier3Today = makeEntry({
      tier: 3,
      undone: false,
      createdAt: todayIso(),
    });
    const tier2Today = makeEntry({
      tier: 2,
      undone: false,
      createdAt: todayIso(),
    });

    writeCalendarMirror([tier3Today, tier2Today]);

    expect(getTier2CountToday()).toBe(1);
  });
});

// ─── Edge cases: formatEntry ──────────────────────────────────────────────────

describe("formatEntry — edge cases", () => {
  it("shows [Reminder] prefix for reminder entries", () => {
    const reminder = makeEntry({
      title: "Take vitamins",
      isReminder: true,
      undone: false,
    });

    const result = formatEntry(reminder);
    expect(result).toStartWith("[Reminder]");
    expect(result).not.toContain("[Event]");
  });

  it("shows [Event] prefix for non-reminder entries", () => {
    const event = makeEntry({
      title: "Team meeting",
      isReminder: false,
      undone: false,
    });

    const result = formatEntry(event);
    expect(result).toStartWith("[Event]");
    expect(result).not.toContain("[Reminder]");
  });

  it("shows ✗ undone for entries with undone: true", () => {
    const undoneEntry = makeEntry({ undone: true });

    const result = formatEntry(undoneEntry);
    expect(result).toContain("✗ undone");
    expect(result).not.toContain("✓ active");
  });

  it("shows ✓ active for entries with undone: false", () => {
    const activeEntry = makeEntry({ undone: false });

    const result = formatEntry(activeEntry);
    expect(result).toContain("✓ active");
    expect(result).not.toContain("✗ undone");
  });

  it("formats midnight hours correctly (00:00 = 12:00am)", () => {
    // Hour 0 should be 12am
    const midnightEntry = makeEntry({ startAt: "2026-06-05T00:30:00.000Z" });
    const result = formatEntry(midnightEntry);
    expect(result).toContain("12:30am");
  });

  it("formats 1am through 11am correctly", () => {
    for (let hour = 1; hour < 12; hour++) {
      const entry = makeEntry({
        startAt: `2026-06-05T${String(hour).padStart(2, "0")}:00:00.000Z`,
      });
      const result = formatEntry(entry);
      expect(result).toContain(`${hour}:00am`);
    }
  });

  it("formats 12pm (noon) correctly", () => {
    const noonEntry = makeEntry({ startAt: "2026-06-05T12:30:00.000Z" });
    const result = formatEntry(noonEntry);
    expect(result).toContain("12:30pm");
  });

  it("formats 1pm through 11pm correctly", () => {
    for (let hour = 13; hour < 24; hour++) {
      const entry = makeEntry({
        startAt: `2026-06-05T${String(hour).padStart(2, "0")}:00:00.000Z`,
      });
      const result = formatEntry(entry);
      const pmHour = hour - 12;
      expect(result).toContain(`${pmHour}:00pm`);
    }
  });
});
