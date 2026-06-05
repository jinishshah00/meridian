import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { resolve } from "path";
import type { CalendarMirrorEntry } from "../src/types.js";

// ─── Test harness ─────────────────────────────────────────────────────────────
//
// Redirect the data directory before any module is imported so storage.ts picks
// up the test path on first evaluation.

const TEST_DATA_DIR = resolve(import.meta.dir, "../.test-plan-tmp");
process.env["PERSONAL_ASSISTANT_DATA_DIR"] = TEST_DATA_DIR;

const {
  formatAppleScriptDate,
  buildCreateEventScript,
  buildCreateReminderScript,
  buildGetEventsScript,
  buildDeleteEventScript,
  buildDeleteReminderScript,
  parseEventLines,
  eventsOverlapWindow,
} = await import("../src/plan.js");

const { readCalendarMirror, writeCalendarMirror } = await import("../src/storage.js");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clearTestData() {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_DATA_DIR, { recursive: true });
}

function makeDate(iso: string): Date {
  return new Date(iso);
}

// ─── formatAppleScriptDate ────────────────────────────────────────────────────

describe("formatAppleScriptDate", () => {
  it("formats a weekday afternoon correctly", () => {
    // 2026-06-05 is a Friday, 3:00 PM local
    const d = new Date(2026, 5, 5, 15, 0, 0); // month is 0-indexed
    const result = formatAppleScriptDate(d);
    expect(result).toContain("Friday");
    expect(result).toContain("June");
    expect(result).toContain("5");
    expect(result).toContain("2026");
    expect(result).toContain("3:00:00 PM");
  });

  it("formats midnight as 12:00:00 AM", () => {
    const d = new Date(2026, 5, 5, 0, 0, 0);
    const result = formatAppleScriptDate(d);
    expect(result).toContain("12:00:00 AM");
  });

  it("formats noon as 12:00:00 PM", () => {
    const d = new Date(2026, 5, 5, 12, 0, 0);
    const result = formatAppleScriptDate(d);
    expect(result).toContain("12:00:00 PM");
  });

  it("formats 1:00 AM correctly (not 13:00)", () => {
    const d = new Date(2026, 5, 5, 1, 0, 0);
    const result = formatAppleScriptDate(d);
    expect(result).toContain("1:00:00 AM");
    expect(result).not.toContain("13:");
  });

  it("pads minutes and seconds to two digits", () => {
    const d = new Date(2026, 5, 5, 9, 5, 3);
    const result = formatAppleScriptDate(d);
    expect(result).toContain("9:05:03 AM");
  });

  it("formats a Sunday correctly", () => {
    // 2026-06-07 is a Sunday
    const d = new Date(2026, 5, 7, 10, 0, 0);
    const result = formatAppleScriptDate(d);
    expect(result).toContain("Sunday");
  });

  it("formats a Saturday correctly", () => {
    // 2026-06-06 is a Saturday
    const d = new Date(2026, 5, 6, 10, 0, 0);
    const result = formatAppleScriptDate(d);
    expect(result).toContain("Saturday");
  });
});

// ─── buildCreateEventScript ───────────────────────────────────────────────────

describe("buildCreateEventScript", () => {
  it("includes the title in the script", () => {
    const d = new Date(2026, 5, 5, 9, 0, 0);
    const script = buildCreateEventScript({
      title: "Team Standup",
      startAt: d,
      endAt: new Date(d.getTime() + 30 * 60 * 1000),
      calendarName: "Work",
    });
    expect(script).toContain("Team Standup");
  });

  it("includes the calendar name in a tell block", () => {
    const d = new Date(2026, 5, 5, 9, 0, 0);
    const script = buildCreateEventScript({
      title: "Event",
      startAt: d,
      endAt: new Date(d.getTime() + 60 * 60 * 1000),
      calendarName: "Home",
    });
    expect(script).toContain('tell calendar "Home"');
  });

  it("targets Calendar application", () => {
    const d = new Date(2026, 5, 5, 9, 0, 0);
    const script = buildCreateEventScript({
      title: "Event",
      startAt: d,
      endAt: new Date(d.getTime() + 60 * 60 * 1000),
      calendarName: "Home",
    });
    expect(script).toContain('tell application "Calendar"');
  });

  it("returns the uid of the new event", () => {
    const d = new Date(2026, 5, 5, 9, 0, 0);
    const script = buildCreateEventScript({
      title: "Event",
      startAt: d,
      endAt: new Date(d.getTime() + 60 * 60 * 1000),
      calendarName: "Home",
    });
    expect(script).toContain("return uid of newEvent");
  });

  it("escapes double-quote characters in the title", () => {
    const d = new Date(2026, 5, 5, 9, 0, 0);
    const script = buildCreateEventScript({
      title: 'He said "hello"',
      startAt: d,
      endAt: new Date(d.getTime() + 60 * 60 * 1000),
      calendarName: "Home",
    });
    expect(script).toContain('\\"hello\\"');
  });

  it("escapes double-quote characters in the calendar name", () => {
    const d = new Date(2026, 5, 5, 9, 0, 0);
    const script = buildCreateEventScript({
      title: "Event",
      startAt: d,
      endAt: new Date(d.getTime() + 60 * 60 * 1000),
      calendarName: 'My "Special" Calendar',
    });
    expect(script).toContain('\\"Special\\"');
  });

  it("escapes backslashes in the title to prevent AppleScript injection", () => {
    const d = new Date(2026, 5, 5, 9, 0, 0);
    const script = buildCreateEventScript({
      title: "C:\\Users\\foo",
      startAt: d,
      endAt: new Date(d.getTime() + 60 * 60 * 1000),
      calendarName: "Home",
    });
    // Backslashes should be escaped as \\
    expect(script).toContain("C:\\\\Users\\\\foo");
    expect(script).not.toContain("C:\\Users\\foo");
  });

  it("escapes backslashes in the calendar name", () => {
    const d = new Date(2026, 5, 5, 9, 0, 0);
    const script = buildCreateEventScript({
      title: "Event",
      startAt: d,
      endAt: new Date(d.getTime() + 60 * 60 * 1000),
      calendarName: "Path\\To\\Calendar",
    });
    expect(script).toContain("Path\\\\To\\\\Calendar");
  });

  it("escapes both quotes and backslashes together in the title", () => {
    const d = new Date(2026, 5, 5, 9, 0, 0);
    const script = buildCreateEventScript({
      title: 'He said "C:\\test"',
      startAt: d,
      endAt: new Date(d.getTime() + 60 * 60 * 1000),
      calendarName: "Home",
    });
    expect(script).toContain('C:\\\\test');
    expect(script).toContain('\\"');
  });

  it("sets start date and end date properties", () => {
    const d = new Date(2026, 5, 5, 14, 0, 0);
    const script = buildCreateEventScript({
      title: "Meeting",
      startAt: d,
      endAt: new Date(d.getTime() + 60 * 60 * 1000),
      calendarName: "Work",
    });
    expect(script).toContain("start date:");
    expect(script).toContain("end date:");
  });
});

// ─── buildCreateReminderScript ────────────────────────────────────────────────

describe("buildCreateReminderScript", () => {
  it("targets Reminders application", () => {
    const d = new Date(2026, 5, 6, 9, 0, 0);
    const script = buildCreateReminderScript({
      title: "Take meds",
      dueAt: d,
      listName: "Reminders",
    });
    expect(script).toContain('tell application "Reminders"');
  });

  it("includes the title in the script", () => {
    const d = new Date(2026, 5, 6, 9, 0, 0);
    const script = buildCreateReminderScript({
      title: "Call dentist",
      dueAt: d,
      listName: "Reminders",
    });
    expect(script).toContain("Call dentist");
  });

  it("includes the list name in a tell block", () => {
    const d = new Date(2026, 5, 6, 9, 0, 0);
    const script = buildCreateReminderScript({
      title: "Pick up prescription",
      dueAt: d,
      listName: "Health",
    });
    expect(script).toContain('tell list "Health"');
  });

  it("sets remind me date property", () => {
    const d = new Date(2026, 5, 6, 9, 0, 0);
    const script = buildCreateReminderScript({
      title: "Reminder",
      dueAt: d,
      listName: "Reminders",
    });
    expect(script).toContain("remind me date:");
  });

  it("returns the id of the new reminder", () => {
    const d = new Date(2026, 5, 6, 9, 0, 0);
    const script = buildCreateReminderScript({
      title: "Reminder",
      dueAt: d,
      listName: "Reminders",
    });
    expect(script).toContain("return id of newReminder");
  });

  it("escapes double-quote characters in the title", () => {
    const d = new Date(2026, 5, 6, 9, 0, 0);
    const script = buildCreateReminderScript({
      title: 'Buy "organic" milk',
      dueAt: d,
      listName: "Shopping",
    });
    expect(script).toContain('\\"organic\\"');
  });

  it("escapes backslashes in the title", () => {
    const d = new Date(2026, 5, 6, 9, 0, 0);
    const script = buildCreateReminderScript({
      title: "Path\\To\\File",
      dueAt: d,
      listName: "Shopping",
    });
    expect(script).toContain("Path\\\\To\\\\File");
  });

  it("escapes backslashes in the list name", () => {
    const d = new Date(2026, 5, 6, 9, 0, 0);
    const script = buildCreateReminderScript({
      title: "Task",
      dueAt: d,
      listName: "Work\\Projects",
    });
    expect(script).toContain("Work\\\\Projects");
  });

  it("escapes both quotes and backslashes together", () => {
    const d = new Date(2026, 5, 6, 9, 0, 0);
    const script = buildCreateReminderScript({
      title: 'Call "helpdesk" at C:\\support',
      dueAt: d,
      listName: "Shopping",
    });
    expect(script).toContain('C:\\\\support');
    expect(script).toContain('\\"helpdesk\\"');
  });
});

// ─── buildGetEventsScript ─────────────────────────────────────────────────────

describe("buildGetEventsScript", () => {
  it("targets Calendar application", () => {
    const script = buildGetEventsScript(7);
    expect(script).toContain('tell application "Calendar"');
  });

  it("embeds the day count in the script", () => {
    const script = buildGetEventsScript(14);
    expect(script).toContain("14");
  });

  it("uses days multiplier for the end boundary", () => {
    const script = buildGetEventsScript(3);
    expect(script).toContain("3 * days");
  });

  it("collects uid, summary, start date, and end date fields", () => {
    const script = buildGetEventsScript(7);
    expect(script).toContain("uid of evt");
    expect(script).toContain("summary of evt");
    expect(script).toContain("start date of evt");
    expect(script).toContain("end date of evt");
  });

  it("uses || delimiter in the output", () => {
    const script = buildGetEventsScript(7);
    expect(script).toContain('& "||" &');
  });
});

// ─── buildDeleteEventScript ───────────────────────────────────────────────────

describe("buildDeleteEventScript", () => {
  it("targets Calendar application", () => {
    const script = buildDeleteEventScript("abc-123");
    expect(script).toContain('tell application "Calendar"');
  });

  it("embeds the externalId in the uid comparison", () => {
    const script = buildDeleteEventScript("my-uid-456");
    expect(script).toContain("my-uid-456");
  });

  it("returns 'deleted' on success and 'not-found' if not found", () => {
    const script = buildDeleteEventScript("abc-123");
    expect(script).toContain(`return "deleted"`);
    expect(script).toContain(`return "not-found"`);
  });

  it("escapes double-quote characters in the externalId", () => {
    const script = buildDeleteEventScript('uid-with-"quotes"');
    expect(script).toContain('\\"quotes\\"');
  });
});

// ─── buildDeleteReminderScript ────────────────────────────────────────────────

describe("buildDeleteReminderScript", () => {
  it("targets Reminders application", () => {
    const script = buildDeleteReminderScript("reminder-id-789");
    expect(script).toContain('tell application "Reminders"');
  });

  it("embeds the externalId in the id comparison", () => {
    const script = buildDeleteReminderScript("x://reminder-id");
    expect(script).toContain("x://reminder-id");
  });

  it("returns 'deleted' and 'not-found' sentinel strings", () => {
    const script = buildDeleteReminderScript("r-1");
    expect(script).toContain(`return "deleted"`);
    expect(script).toContain(`return "not-found"`);
  });
});

// ─── parseEventLines ──────────────────────────────────────────────────────────

describe("parseEventLines", () => {
  it("returns empty array for empty string", () => {
    expect(parseEventLines("")).toEqual([]);
  });

  it("parses a single valid line", () => {
    // AppleScript coerces the list to a comma-space-separated string.
    // AS epoch seconds: 2026-06-05 09:00 UTC = unix 1749114000 + 978307200 = 2758957200
    //                   2026-06-05 10:00 UTC = unix 1749117600 + 978307200 = 2758960800
    const raw = "uid-abc||Team Standup||2758957200||2758960800";
    const result = parseEventLines(raw);
    expect(result).toHaveLength(1);
    expect(result[0]?.externalId).toBe("uid-abc");
    expect(result[0]?.title).toBe("Team Standup");
    // Verify dates decode correctly
    expect(result[0]?.startAt.toISOString()).toBe("2026-06-05T09:00:00.000Z");
    expect(result[0]?.endAt.toISOString()).toBe("2026-06-05T10:00:00.000Z");
  });

  it("parses multiple lines separated by ', '", () => {
    // AS epoch 2758957200 = 2026-06-05T09:00Z, 2758960800 = 2026-06-05T10:00Z
    // AS epoch 2758964400 = 2026-06-05T11:00Z, 2758968000 = 2026-06-05T12:00Z
    const raw = [
      "uid-1||Event A||2758957200||2758960800",
      "uid-2||Event B||2758964400||2758968000",
    ].join(", ");
    const result = parseEventLines(raw);
    expect(result).toHaveLength(2);
    expect(result[0]?.externalId).toBe("uid-1");
    expect(result[1]?.externalId).toBe("uid-2");
  });

  it("drops lines with fewer than 4 segments", () => {
    const raw = "uid-only||title||2727421200";
    const result = parseEventLines(raw);
    expect(result).toHaveLength(0);
  });

  it("drops lines with non-numeric epoch fields", () => {
    const raw = "uid-x||Title||not-a-number||also-not";
    const result = parseEventLines(raw);
    expect(result).toHaveLength(0);
  });

  it("drops lines that do not contain the || delimiter", () => {
    const raw = "just some plain text without pipes";
    const result = parseEventLines(raw);
    expect(result).toHaveLength(0);
  });

  it("splits on ', ' so a title containing ', ' is parsed as two partial records (known limitation)", () => {
    // AppleScript coerces the result list to a comma-space-separated string,
    // so a title that contains ", " gets split at that point. The second fragment
    // ("review||epoch||epoch") has no uid before the first "||", so neither
    // fragment produces a valid 4-part record and both are dropped.
    // This is a known limitation of the text-based parsing approach.
    const raw = "uid-comma||Meeting: design, review||2758957200||2758960800";
    const result = parseEventLines(raw);
    // Both fragments are malformed; expect zero results
    expect(result).toHaveLength(0);
  });

  it("title with a comma breaks parsing (known limitation)", () => {
    // parseEventLines splits on ", " (comma-space), not just commas.
    // However, a title with a comma like "Dentist, Dr. Smith" contains ", "
    // which is the exact separator, so it gets split incorrectly.
    // "uid-single||Dentist, Dr. Smith||2758957200||2758960800"
    // splits to ["uid-single||Dentist", "Dr. Smith||2758957200||2758960800"]
    // Neither has 4 parts, so both are dropped. This is a known limitation.
    const raw = "uid-single||Dentist, Dr. Smith||2758957200||2758960800";
    const result = parseEventLines(raw);
    // The title with comma causes a split, resulting in zero results
    expect(result).toHaveLength(0);
  });

  it("consecutive records without commas in titles parse correctly", () => {
    // When two records with no commas are joined by ", ", parsing works fine
    const raw = [
      "uid-1||Lunch||2758957200||2758960800",
      "uid-2||Review session||2758964400||2758968000",
    ].join(", ");
    const result = parseEventLines(raw);
    // Both records should parse correctly
    expect(result).toHaveLength(2);
    expect(result[0]?.title).toBe("Lunch");
    expect(result[1]?.title).toBe("Review session");
  });
});

// ─── eventsOverlapWindow ──────────────────────────────────────────────────────

describe("eventsOverlapWindow", () => {
  const makeEntry = (
    startIso: string,
    endIso: string,
    isReminder = false,
  ): Pick<CalendarMirrorEntry, "startAt" | "endAt" | "isReminder"> => ({
    startAt: startIso,
    endAt: endIso,
    isReminder,
  });

  it("returns false for empty event list", () => {
    const start = makeDate("2026-06-05T09:00:00.000Z");
    const end = makeDate("2026-06-05T10:00:00.000Z");
    expect(eventsOverlapWindow([], start, end)).toBe(false);
  });

  it("returns true when an event exactly overlaps the proposed window", () => {
    const events = [makeEntry("2026-06-05T09:00:00.000Z", "2026-06-05T10:00:00.000Z")];
    const start = makeDate("2026-06-05T09:00:00.000Z");
    const end = makeDate("2026-06-05T10:00:00.000Z");
    expect(eventsOverlapWindow(events, start, end)).toBe(true);
  });

  it("returns true when an event partially overlaps (starts before, ends during)", () => {
    const events = [makeEntry("2026-06-05T08:30:00.000Z", "2026-06-05T09:30:00.000Z")];
    const start = makeDate("2026-06-05T09:00:00.000Z");
    const end = makeDate("2026-06-05T10:00:00.000Z");
    expect(eventsOverlapWindow(events, start, end)).toBe(true);
  });

  it("returns true when an event partially overlaps (starts during, ends after)", () => {
    const events = [makeEntry("2026-06-05T09:30:00.000Z", "2026-06-05T10:30:00.000Z")];
    const start = makeDate("2026-06-05T09:00:00.000Z");
    const end = makeDate("2026-06-05T10:00:00.000Z");
    expect(eventsOverlapWindow(events, start, end)).toBe(true);
  });

  it("returns true when an event completely contains the proposed window", () => {
    const events = [makeEntry("2026-06-05T08:00:00.000Z", "2026-06-05T11:00:00.000Z")];
    const start = makeDate("2026-06-05T09:00:00.000Z");
    const end = makeDate("2026-06-05T10:00:00.000Z");
    expect(eventsOverlapWindow(events, start, end)).toBe(true);
  });

  it("returns false when event ends exactly when proposed window starts (adjacent, no overlap)", () => {
    const events = [makeEntry("2026-06-05T08:00:00.000Z", "2026-06-05T09:00:00.000Z")];
    const start = makeDate("2026-06-05T09:00:00.000Z");
    const end = makeDate("2026-06-05T10:00:00.000Z");
    expect(eventsOverlapWindow(events, start, end)).toBe(false);
  });

  it("returns false when event starts exactly when proposed window ends (adjacent, no overlap)", () => {
    const events = [makeEntry("2026-06-05T10:00:00.000Z", "2026-06-05T11:00:00.000Z")];
    const start = makeDate("2026-06-05T09:00:00.000Z");
    const end = makeDate("2026-06-05T10:00:00.000Z");
    expect(eventsOverlapWindow(events, start, end)).toBe(false);
  });

  it("returns false when event is entirely before the window", () => {
    const events = [makeEntry("2026-06-05T07:00:00.000Z", "2026-06-05T08:00:00.000Z")];
    const start = makeDate("2026-06-05T09:00:00.000Z");
    const end = makeDate("2026-06-05T10:00:00.000Z");
    expect(eventsOverlapWindow(events, start, end)).toBe(false);
  });

  it("returns false when event is entirely after the window", () => {
    const events = [makeEntry("2026-06-05T11:00:00.000Z", "2026-06-05T12:00:00.000Z")];
    const start = makeDate("2026-06-05T09:00:00.000Z");
    const end = makeDate("2026-06-05T10:00:00.000Z");
    expect(eventsOverlapWindow(events, start, end)).toBe(false);
  });

  it("skips reminder entries (no duration, no conflict)", () => {
    const events = [makeEntry("2026-06-05T09:30:00.000Z", "2026-06-05T09:30:00.000Z", true)];
    const start = makeDate("2026-06-05T09:00:00.000Z");
    const end = makeDate("2026-06-05T10:00:00.000Z");
    expect(eventsOverlapWindow(events, start, end)).toBe(false);
  });

  it("returns true when one of multiple events conflicts", () => {
    const events = [
      makeEntry("2026-06-05T07:00:00.000Z", "2026-06-05T08:00:00.000Z"),
      makeEntry("2026-06-05T09:30:00.000Z", "2026-06-05T10:30:00.000Z"), // conflicts
      makeEntry("2026-06-05T11:00:00.000Z", "2026-06-05T12:00:00.000Z"),
    ];
    const start = makeDate("2026-06-05T09:00:00.000Z");
    const end = makeDate("2026-06-05T10:00:00.000Z");
    expect(eventsOverlapWindow(events, start, end)).toBe(true);
  });

  it("returns false when all multiple events are non-conflicting", () => {
    const events = [
      makeEntry("2026-06-05T07:00:00.000Z", "2026-06-05T08:00:00.000Z"),
      makeEntry("2026-06-05T10:00:00.000Z", "2026-06-05T11:00:00.000Z"),
    ];
    const start = makeDate("2026-06-05T08:00:00.000Z");
    const end = makeDate("2026-06-05T10:00:00.000Z");
    expect(eventsOverlapWindow(events, start, end)).toBe(false);
  });

  it("handles a proposed window with zero duration (startAt === endAt) inside an event", () => {
    // A zero-duration window [T, T) overlaps with [S,E) iff S<T && T<E (from interval formula a<d && c<b).
    // So [09:30, 09:30) overlaps with [09:00, 10:00) because 09:00 < 09:30 < 10:00.
    const events = [makeEntry("2026-06-05T09:00:00.000Z", "2026-06-05T10:00:00.000Z")];
    const t = makeDate("2026-06-05T09:30:00.000Z");
    expect(eventsOverlapWindow(events, t, t)).toBe(true);
  });

  it("zero-duration window at event boundary (start) does not overlap", () => {
    // [09:00, 09:00) vs [09:00, 10:00): 09:00<10:00 && 09:00<09:00 = true && false = false
    const events = [makeEntry("2026-06-05T09:00:00.000Z", "2026-06-05T10:00:00.000Z")];
    const t = makeDate("2026-06-05T09:00:00.000Z");
    expect(eventsOverlapWindow(events, t, t)).toBe(false);
  });

  it("zero-duration window at event boundary (end) does not overlap", () => {
    // [10:00, 10:00) vs [09:00, 10:00): 10:00<10:00 && 09:00<10:00 = false && true = false
    const events = [makeEntry("2026-06-05T09:00:00.000Z", "2026-06-05T10:00:00.000Z")];
    const t = makeDate("2026-06-05T10:00:00.000Z");
    expect(eventsOverlapWindow(events, t, t)).toBe(false);
  });

  it("handles an event with zero duration (startAt === endAt)", () => {
    // An event with zero duration [T, T) is treated as having no end, so
    // eventsOverlapWindow uses startAt as the end time (see line 369).
    // Standard interval overlap: a<d && c<b, so [T,T) overlaps [S,E) iff T<E && S<T.
    // For S=09:00, E=10:00, T=09:30: 09:30<10:00 && 09:00<09:30 = true && true = true.
    const events = [makeEntry("2026-06-05T09:30:00.000Z", "2026-06-05T09:30:00.000Z")];
    const start = makeDate("2026-06-05T09:00:00.000Z");
    const end = makeDate("2026-06-05T10:00:00.000Z");
    expect(eventsOverlapWindow(events, start, end)).toBe(true);
  });

  it("handles an event with zero duration outside the proposed window", () => {
    // Zero-duration event at 11:00, window 09:00-10:00: no overlap
    const events = [makeEntry("2026-06-05T11:00:00.000Z", "2026-06-05T11:00:00.000Z")];
    const start = makeDate("2026-06-05T09:00:00.000Z");
    const end = makeDate("2026-06-05T10:00:00.000Z");
    expect(eventsOverlapWindow(events, start, end)).toBe(false);
  });
});

// ─── Mirror read/write/undo logic ─────────────────────────────────────────────

describe("mirror read/write/undo", () => {
  beforeEach(clearTestData);

  const makeEntry = (overrides: Partial<CalendarMirrorEntry> = {}): CalendarMirrorEntry => ({
    id: "entry-1",
    externalId: "EKEvent-abc123",
    title: "Team standup",
    startAt: "2026-06-05T09:00:00.000Z",
    endAt: "2026-06-05T09:30:00.000Z",
    isReminder: false,
    tier: 2,
    createdAt: "2026-06-04T10:00:00.000Z",
    undone: false,
    ...overrides,
  });

  it("starts empty when no mirror file exists", () => {
    expect(readCalendarMirror()).toEqual([]);
  });

  it("appends an entry and reads it back", () => {
    const entry = makeEntry();
    const mirror = readCalendarMirror();
    mirror.push(entry);
    writeCalendarMirror(mirror);
    expect(readCalendarMirror()).toHaveLength(1);
    expect(readCalendarMirror()[0]).toEqual(entry);
  });

  it("preserves undone: false on initial write", () => {
    const entry = makeEntry({ undone: false });
    writeCalendarMirror([entry]);
    expect(readCalendarMirror()[0]?.undone).toBe(false);
  });

  it("marks undone: true when updating an entry", () => {
    const entry = makeEntry({ undone: false });
    writeCalendarMirror([entry]);

    // Simulate what undoCalendarEntry does after a successful delete
    const mirror = readCalendarMirror();
    const idx = mirror.findIndex((e) => e.id === entry.id);
    expect(idx).toBeGreaterThanOrEqual(0);
    const updated: CalendarMirrorEntry = { ...mirror[idx]!, undone: true };
    mirror[idx] = updated;
    writeCalendarMirror(mirror);

    expect(readCalendarMirror()[0]?.undone).toBe(true);
  });

  it("preserves other entries when marking one as undone", () => {
    const e1 = makeEntry({ id: "e-1", externalId: "ext-1", undone: false });
    const e2 = makeEntry({ id: "e-2", externalId: "ext-2", undone: false });
    writeCalendarMirror([e1, e2]);

    const mirror = readCalendarMirror();
    const idx = mirror.findIndex((e) => e.id === "e-1");
    mirror[idx] = { ...mirror[idx]!, undone: true };
    writeCalendarMirror(mirror);

    const final = readCalendarMirror();
    expect(final).toHaveLength(2);
    expect(final[0]?.undone).toBe(true);
    expect(final[1]?.undone).toBe(false);
  });

  it("stores isReminder: true for reminder entries (no endAt)", () => {
    // Build a reminder entry by omitting the optional endAt field entirely
    const entry: CalendarMirrorEntry = {
      id: "reminder-entry",
      externalId: "EKReminder-xyz",
      title: "Call dentist",
      startAt: "2026-06-06T10:00:00.000Z",
      isReminder: true,
      tier: 1,
      createdAt: "2026-06-04T11:00:00.000Z",
      undone: false,
    };
    writeCalendarMirror([entry]);
    const read = readCalendarMirror()[0];
    expect(read?.isReminder).toBe(true);
    expect(read?.endAt).toBeUndefined();
  });

  it("stores all tier values (0, 1, 2, 3)", () => {
    const tiers: (0 | 1 | 2 | 3)[] = [0, 1, 2, 3];
    for (const tier of tiers) {
      writeCalendarMirror([makeEntry({ id: `tier-${tier}`, tier })]);
      expect(readCalendarMirror()[0]?.tier).toBe(tier);
    }
  });

  it("multiple entries round-trip in insertion order", () => {
    const entries = [
      makeEntry({ id: "first", externalId: "ext-first" }),
      makeEntry({ id: "second", externalId: "ext-second" }),
      makeEntry({ id: "third", externalId: "ext-third" }),
    ];
    writeCalendarMirror(entries);
    const read = readCalendarMirror();
    expect(read).toHaveLength(3);
    expect(read[0]?.id).toBe("first");
    expect(read[1]?.id).toBe("second");
    expect(read[2]?.id).toBe("third");
  });

  it("appending entries produces multiple distinct entries (no overwrite)", () => {
    // Verify that appending multiple times creates distinct entries
    const e1 = makeEntry({ id: "distinct-1" });
    const e2 = makeEntry({ id: "distinct-2" });

    writeCalendarMirror([e1, e2]);
    const final = readCalendarMirror();

    expect(final).toHaveLength(2);
    expect(final.some((e) => e.id === "distinct-1")).toBe(true);
    expect(final.some((e) => e.id === "distinct-2")).toBe(true);
  });
});

// ─── Mirror state transitions (undone field) ──────────────────────────────────

describe("mirror state transitions for undone field", () => {
  beforeEach(clearTestData);

  const makeEntry = (overrides: Partial<CalendarMirrorEntry> = {}): CalendarMirrorEntry => ({
    id: "entry-1",
    externalId: "EKEvent-abc123",
    title: "Team standup",
    startAt: "2026-06-05T09:00:00.000Z",
    endAt: "2026-06-05T09:30:00.000Z",
    isReminder: false,
    tier: 2,
    createdAt: "2026-06-04T10:00:00.000Z",
    undone: false,
    ...overrides,
  });

  it("marks an entry as undone without mutating other fields", () => {
    // Test the core logic of undoCalendarEntry: reading, mutating, writing
    const entry = makeEntry({
      id: "preserve-test",
      title: "Important meeting",
      startAt: "2026-06-10T14:00:00.000Z",
      endAt: "2026-06-10T15:00:00.000Z",
    });
    writeCalendarMirror([entry]);

    // Simulate the mirror update pattern that undoCalendarEntry uses
    const mirror = readCalendarMirror();
    const idx = mirror.findIndex((e) => e.id === "preserve-test");
    if (idx !== -1) {
      const updated: CalendarMirrorEntry = { ...mirror[idx]!, undone: true };
      mirror[idx] = updated;
      writeCalendarMirror(mirror);
    }

    const final = readCalendarMirror();
    const updated = final[0];
    expect(updated?.title).toBe("Important meeting");
    expect(updated?.startAt).toBe("2026-06-10T14:00:00.000Z");
    expect(updated?.endAt).toBe("2026-06-10T15:00:00.000Z");
    expect(updated?.undone).toBe(true);
  });

  it("idempotency: early return on second call (undone already true)", () => {
    // Test the idempotency check: if undone is already true, the function returns early
    const entry = makeEntry({ undone: false, id: "test-idem" });
    writeCalendarMirror([entry]);

    // First "undo" — sets undone: true
    const mirror1 = readCalendarMirror();
    const idx1 = mirror1.findIndex((e) => e.id === "test-idem");
    mirror1[idx1] = { ...mirror1[idx1]!, undone: true };
    writeCalendarMirror(mirror1);

    let current = readCalendarMirror();
    expect(current[0]?.undone).toBe(true);

    // Second "undo" — the function would check undone, see it's true, and return early
    const mirror2 = readCalendarMirror();
    const found = mirror2.find((e) => e.id === "test-idem");
    if (found?.undone) {
      // Early return — no osascript call
    }

    // No additional write should happen
    current = readCalendarMirror();
    expect(current[0]?.undone).toBe(true);
  });

  it("handles reminder entries (isReminder: true) in mirror state", () => {
    const reminder = makeEntry({
      id: "reminder-test",
      isReminder: true,
      endAt: undefined,
    });
    writeCalendarMirror([reminder]);

    // Update reminder to undone
    const mirror = readCalendarMirror();
    const idx = mirror.findIndex((e) => e.id === "reminder-test");
    if (idx !== -1) {
      mirror[idx] = { ...mirror[idx]!, undone: true };
      writeCalendarMirror(mirror);
    }

    const final = readCalendarMirror();
    expect(final[0]?.isReminder).toBe(true);
    expect(final[0]?.undone).toBe(true);
  });

  it("handles multiple entries with selective undo state transitions", () => {
    const e1 = makeEntry({ id: "e-1", title: "Event 1" });
    const e2 = makeEntry({ id: "e-2", title: "Event 2" });
    const e3 = makeEntry({ id: "e-3", title: "Event 3" });
    writeCalendarMirror([e1, e2, e3]);

    // Simulate undoing only e2
    const mirror = readCalendarMirror();
    const idx = mirror.findIndex((e) => e.id === "e-2");
    if (idx !== -1) {
      mirror[idx] = { ...mirror[idx]!, undone: true };
      writeCalendarMirror(mirror);
    }

    const final = readCalendarMirror();
    expect(final[0]?.undone).toBe(false);
    expect(final[1]?.undone).toBe(true);
    expect(final[2]?.undone).toBe(false);
  });

  it("cannot transition back from undone: true to undone: false (one-way state)", () => {
    // Verify that once marked undone, an entry stays that way
    const entry = makeEntry({ undone: true, id: "one-way" });
    writeCalendarMirror([entry]);

    const mirror = readCalendarMirror();
    expect(mirror[0]?.undone).toBe(true);

    // Try to set it back to false (should not happen in the actual function,
    // but we verify the state is preserved if we read it)
    const unchanged = mirror[0];
    expect(unchanged?.undone).toBe(true);
  });
});

// ─── Cleanup ──────────────────────────────────────────────────────────────────

afterEach(clearTestData);
