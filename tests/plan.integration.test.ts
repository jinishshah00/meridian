/**
 * Integration tests for the Plan layer.
 *
 * These tests call real osascript and modify Apple Calendar / Reminders on the
 * running Mac. They are skipped unless the environment variable
 * RUN_INTEGRATION=1 is set.
 *
 * Usage:
 *   RUN_INTEGRATION=1 bun test tests/plan.integration.test.ts
 *
 * Prerequisites:
 *   - macOS with Calendar.app and Reminders.app
 *   - Full Disk Access or Automation permission for Terminal / the Bun process
 *     granted in System Settings → Privacy & Security → Automation
 *   - A calendar named "personal-assistant-test" must exist in Calendar.app
 *     (create it manually before running)
 *   - A reminder list named "personal-assistant-test" must exist in
 *     Reminders.app (create it manually before running)
 *
 * Each test cleans up the events/reminders it creates.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { resolve } from "path";

const RUN = process.env["RUN_INTEGRATION"] === "1";
const TEST_CALENDAR = "personal-assistant-test";
const TEST_REMINDER_LIST = "personal-assistant-test";

const TEST_DATA_DIR = resolve(import.meta.dir, "../.test-integration-tmp");
process.env["PERSONAL_ASSISTANT_DATA_DIR"] = TEST_DATA_DIR;

const {
  createCalendarEvent,
  createReminder,
  getUpcomingEvents,
  hasConflict,
  undoCalendarEntry,
} = await import("../src/plan.js");

const { readCalendarMirror } = await import("../src/storage.js");

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeAll(() => {
  if (!existsSync(TEST_DATA_DIR)) {
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  }
});

afterAll(() => {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a Date N hours from now, rounded to the nearest minute. */
function hoursFromNow(hours: number): Date {
  const d = new Date(Date.now() + hours * 60 * 60 * 1000);
  d.setSeconds(0, 0);
  return d;
}

// ─── Integration tests ────────────────────────────────────────────────────────

describe("createCalendarEvent (integration)", () => {
  it.skipIf(!RUN)("creates a visible event in Apple Calendar and writes a mirror entry", async () => {
    const startAt = hoursFromNow(25);
    const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
    const title = `plan-layer-test-event-${Date.now()}`;

    const entry = await createCalendarEvent({
      title,
      startAt,
      endAt,
      tier: 2,
      calendarName: TEST_CALENDAR,
    });

    expect(entry.externalId).toBeTruthy();
    expect(entry.isReminder).toBe(false);
    expect(entry.undone).toBe(false);
    expect(entry.tier).toBe(2);

    // Mirror should contain this entry
    const mirror = readCalendarMirror();
    const found = mirror.find((e) => e.id === entry.id);
    expect(found).toBeDefined();
    expect(found?.externalId).toBe(entry.externalId);

    // Clean up
    await undoCalendarEntry(entry.id);
  });
});

describe("getUpcomingEvents (integration)", () => {
  it.skipIf(!RUN)("returns at least the event just created", async () => {
    const startAt = hoursFromNow(26);
    const endAt = new Date(startAt.getTime() + 30 * 60 * 1000);
    const title = `plan-layer-read-test-${Date.now()}`;

    const created = await createCalendarEvent({
      title,
      startAt,
      endAt,
      tier: 2,
      calendarName: TEST_CALENDAR,
    });

    const events = await getUpcomingEvents(7);
    const found = events.find((e) => e.externalId === created.externalId);
    expect(found).toBeDefined();
    expect(found?.title).toBe(title);

    // Clean up
    await undoCalendarEntry(created.id);
  });
});

describe("hasConflict (integration)", () => {
  it.skipIf(!RUN)("detects a conflict with an existing event", async () => {
    const startAt = hoursFromNow(27);
    const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);

    const created = await createCalendarEvent({
      title: `conflict-test-${Date.now()}`,
      startAt,
      endAt,
      tier: 2,
      calendarName: TEST_CALENDAR,
    });

    // The same window should now conflict
    const conflict = await hasConflict(startAt, endAt);
    expect(conflict).toBe(true);

    // Clean up
    await undoCalendarEntry(created.id);
  });

  it.skipIf(!RUN)("returns false when no event occupies the proposed window", async () => {
    // Use a window far in the future (365 days) where no events are expected
    const startAt = hoursFromNow(365 * 24 + 1);
    const endAt = new Date(startAt.getTime() + 30 * 60 * 1000);
    const conflict = await hasConflict(startAt, endAt);
    expect(conflict).toBe(false);
  });
});

describe("undoCalendarEntry (integration)", () => {
  it.skipIf(!RUN)("removes the event from Calendar and marks mirror entry as undone", async () => {
    const startAt = hoursFromNow(28);
    const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);

    const entry = await createCalendarEvent({
      title: `undo-test-${Date.now()}`,
      startAt,
      endAt,
      tier: 1,
      calendarName: TEST_CALENDAR,
    });

    await undoCalendarEntry(entry.id);

    const mirror = readCalendarMirror();
    const found = mirror.find((e) => e.id === entry.id);
    expect(found?.undone).toBe(true);
  });

  it.skipIf(!RUN)("is idempotent — calling undo twice does not throw", async () => {
    const startAt = hoursFromNow(29);
    const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);

    const entry = await createCalendarEvent({
      title: `undo-idempotent-${Date.now()}`,
      startAt,
      endAt,
      tier: 1,
      calendarName: TEST_CALENDAR,
    });

    await undoCalendarEntry(entry.id);
    // Second call — event is already gone from Calendar, should warn but not throw
    await expect(undoCalendarEntry(entry.id)).resolves.toBeUndefined();
  });
});

describe("createReminder (integration)", () => {
  it.skipIf(!RUN)("creates a visible reminder in Apple Reminders and writes a mirror entry", async () => {
    const dueAt = hoursFromNow(30);
    const title = `plan-layer-reminder-${Date.now()}`;

    const entry = await createReminder({
      title,
      dueAt,
      tier: 2,
      listName: TEST_REMINDER_LIST,
    });

    expect(entry.externalId).toBeTruthy();
    expect(entry.isReminder).toBe(true);
    expect(entry.endAt).toBeUndefined();
    expect(entry.undone).toBe(false);

    // Mirror should contain this entry
    const mirror = readCalendarMirror();
    const found = mirror.find((e) => e.id === entry.id);
    expect(found).toBeDefined();

    // Clean up
    await undoCalendarEntry(entry.id);
  });
});
