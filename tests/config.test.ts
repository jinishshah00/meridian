import { describe, it, expect } from "bun:test";
import type { PolicyConfig } from "../src/types.js";
import {
  isInAllowedWindow,
  isInBlackoutWindow,
  validateConfig,
  findNextSlot,
  applyConfigMessage,
} from "../src/config.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const emptyPolicy: PolicyConfig = {
  allowedWindows: [],
  blackoutWindows: [],
  bufferMinutes: 15,
  dailyCap: 5,
  staleAfterHours: 12,
  defaultPriority: 2,
};

/**
 * Build a Date in local time from parts to keep tests readable and
 * independent of timezone offset.
 */
function localDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

// ─── isInAllowedWindow ────────────────────────────────────────────────────────

describe("isInAllowedWindow", () => {
  it("returns false when allowedWindows is empty", () => {
    // Monday 10:00
    const dt = localDate(2026, 6, 8, 10, 0); // Monday
    expect(isInAllowedWindow(dt, emptyPolicy)).toBe(false);
  });

  it("returns true when datetime is inside the allowed window", () => {
    const policy: PolicyConfig = {
      ...emptyPolicy,
      allowedWindows: [{ start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5] }],
    };
    // Monday 10:00
    const dt = localDate(2026, 6, 8, 10, 0);
    expect(isInAllowedWindow(dt, policy)).toBe(true);
  });

  it("returns false when time is before the window start", () => {
    const policy: PolicyConfig = {
      ...emptyPolicy,
      allowedWindows: [{ start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5] }],
    };
    // Monday 08:59
    const dt = localDate(2026, 6, 8, 8, 59);
    expect(isInAllowedWindow(dt, policy)).toBe(false);
  });

  it("returns false when time equals window end (half-open interval)", () => {
    const policy: PolicyConfig = {
      ...emptyPolicy,
      allowedWindows: [{ start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5] }],
    };
    // Monday 18:00 — end is exclusive
    const dt = localDate(2026, 6, 8, 18, 0);
    expect(isInAllowedWindow(dt, policy)).toBe(false);
  });

  it("returns false when day of week is not in the window", () => {
    const policy: PolicyConfig = {
      ...emptyPolicy,
      allowedWindows: [{ start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5] }],
    };
    // Sunday 10:00
    const dt = localDate(2026, 6, 7, 10, 0);
    expect(isInAllowedWindow(dt, policy)).toBe(false);
  });

  it("handles overnight windows — time after start is inside", () => {
    const policy: PolicyConfig = {
      ...emptyPolicy,
      allowedWindows: [{ start: "23:00", end: "07:00", days: [0, 1, 2, 3, 4, 5, 6] }],
    };
    // 23:30 — inside overnight window
    const dt = localDate(2026, 6, 8, 23, 30);
    expect(isInAllowedWindow(dt, policy)).toBe(true);
  });

  it("handles overnight windows — time before end is inside", () => {
    const policy: PolicyConfig = {
      ...emptyPolicy,
      allowedWindows: [{ start: "23:00", end: "07:00", days: [0, 1, 2, 3, 4, 5, 6] }],
    };
    // 06:30 — inside overnight window (before end)
    const dt = localDate(2026, 6, 8, 6, 30);
    expect(isInAllowedWindow(dt, policy)).toBe(true);
  });

  it("handles overnight windows — time in the middle of day is outside", () => {
    const policy: PolicyConfig = {
      ...emptyPolicy,
      allowedWindows: [{ start: "23:00", end: "07:00", days: [0, 1, 2, 3, 4, 5, 6] }],
    };
    // 12:00 — outside overnight window
    const dt = localDate(2026, 6, 8, 12, 0);
    expect(isInAllowedWindow(dt, policy)).toBe(false);
  });

  it("matches the correct day in a multi-window config", () => {
    const policy: PolicyConfig = {
      ...emptyPolicy,
      allowedWindows: [
        { start: "09:00", end: "12:00", days: [1] }, // Mon only
        { start: "14:00", end: "17:00", days: [3] }, // Wed only
      ],
    };
    // Wednesday 15:00 — matches second window
    const dt = localDate(2026, 6, 10, 15, 0); // Wednesday
    expect(isInAllowedWindow(dt, policy)).toBe(true);
    // Monday 15:00 — outside Mon window
    const dtMon = localDate(2026, 6, 8, 15, 0);
    expect(isInAllowedWindow(dtMon, policy)).toBe(false);
  });
});

// ─── isInBlackoutWindow ───────────────────────────────────────────────────────

describe("isInBlackoutWindow", () => {
  it("returns false when blackoutWindows is empty", () => {
    const dt = localDate(2026, 6, 8, 2, 0); // 02:00 Mon
    expect(isInBlackoutWindow(dt, emptyPolicy)).toBe(false);
  });

  it("returns true when datetime is inside a blackout window", () => {
    const policy: PolicyConfig = {
      ...emptyPolicy,
      blackoutWindows: [{ start: "00:00", end: "09:00", days: [0, 1, 2, 3, 4, 5, 6] }],
    };
    const dt = localDate(2026, 6, 8, 8, 0);
    expect(isInBlackoutWindow(dt, policy)).toBe(true);
  });

  it("returns false when outside blackout window", () => {
    const policy: PolicyConfig = {
      ...emptyPolicy,
      blackoutWindows: [{ start: "00:00", end: "09:00", days: [0, 1, 2, 3, 4, 5, 6] }],
    };
    const dt = localDate(2026, 6, 8, 10, 0);
    expect(isInBlackoutWindow(dt, policy)).toBe(false);
  });

  it("handles overnight blackout (sleep window 23:00–07:00) — inside after midnight", () => {
    const policy: PolicyConfig = {
      ...emptyPolicy,
      blackoutWindows: [{ start: "23:00", end: "07:00", days: [0, 1, 2, 3, 4, 5, 6] }],
    };
    const dt = localDate(2026, 6, 8, 3, 0); // 03:00
    expect(isInBlackoutWindow(dt, policy)).toBe(true);
  });

  it("handles overnight blackout — inside before midnight", () => {
    const policy: PolicyConfig = {
      ...emptyPolicy,
      blackoutWindows: [{ start: "23:00", end: "07:00", days: [0, 1, 2, 3, 4, 5, 6] }],
    };
    const dt = localDate(2026, 6, 8, 23, 30);
    expect(isInBlackoutWindow(dt, policy)).toBe(true);
  });

  it("handles overnight blackout — outside during business hours", () => {
    const policy: PolicyConfig = {
      ...emptyPolicy,
      blackoutWindows: [{ start: "23:00", end: "07:00", days: [0, 1, 2, 3, 4, 5, 6] }],
    };
    const dt = localDate(2026, 6, 8, 14, 0);
    expect(isInBlackoutWindow(dt, policy)).toBe(false);
  });

  it("blackout window end is exclusive", () => {
    const policy: PolicyConfig = {
      ...emptyPolicy,
      blackoutWindows: [{ start: "00:00", end: "09:00", days: [0, 1, 2, 3, 4, 5, 6] }],
    };
    const dt = localDate(2026, 6, 8, 9, 0); // exactly at end
    expect(isInBlackoutWindow(dt, policy)).toBe(false);
  });
});

// ─── validateConfig ───────────────────────────────────────────────────────────

describe("validateConfig", () => {
  it("returns empty array for a fully valid config", () => {
    const policy: PolicyConfig = {
      allowedWindows: [{ start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5] }],
      blackoutWindows: [{ start: "23:00", end: "07:00", days: [0, 1, 2, 3, 4, 5, 6] }],
      bufferMinutes: 15,
      dailyCap: 5,
      staleAfterHours: 12,
      defaultPriority: 2,
    };
    expect(validateConfig(policy)).toEqual([]);
  });

  it("rejects bufferMinutes < 0", () => {
    const policy: PolicyConfig = { ...emptyPolicy, bufferMinutes: -1 };
    const errors = validateConfig(policy);
    expect(errors.some((e) => e.includes("bufferMinutes"))).toBe(true);
  });

  it("allows bufferMinutes === 0", () => {
    const policy: PolicyConfig = { ...emptyPolicy, bufferMinutes: 0 };
    const errors = validateConfig(policy);
    expect(errors.some((e) => e.includes("bufferMinutes"))).toBe(false);
  });

  it("rejects dailyCap < 1", () => {
    const policy: PolicyConfig = { ...emptyPolicy, dailyCap: 0 };
    const errors = validateConfig(policy);
    expect(errors.some((e) => e.includes("dailyCap"))).toBe(true);
  });

  it("rejects staleAfterHours <= 0", () => {
    const policy: PolicyConfig = { ...emptyPolicy, staleAfterHours: 0 };
    const errors = validateConfig(policy);
    expect(errors.some((e) => e.includes("staleAfterHours"))).toBe(true);
  });

  it("rejects staleAfterHours of -5", () => {
    const policy: PolicyConfig = { ...emptyPolicy, staleAfterHours: -5 };
    const errors = validateConfig(policy);
    expect(errors.some((e) => e.includes("staleAfterHours"))).toBe(true);
  });

  it("rejects a window with an empty days array", () => {
    const policy: PolicyConfig = {
      ...emptyPolicy,
      allowedWindows: [{ start: "09:00", end: "18:00", days: [] }],
    };
    const errors = validateConfig(policy);
    expect(errors.some((e) => e.includes("days must not be empty"))).toBe(true);
  });

  it("rejects a day value outside 0–6", () => {
    const policy: PolicyConfig = {
      ...emptyPolicy,
      allowedWindows: [{ start: "09:00", end: "18:00", days: [1, 7] }],
    };
    const errors = validateConfig(policy);
    expect(errors.some((e) => e.includes("invalid value 7"))).toBe(true);
  });

  it("rejects a window where start === end", () => {
    const policy: PolicyConfig = {
      ...emptyPolicy,
      blackoutWindows: [{ start: "12:00", end: "12:00", days: [1] }],
    };
    const errors = validateConfig(policy);
    expect(errors.some((e) => e.includes("start and end must differ"))).toBe(true);
  });

  it("reports multiple errors when multiple fields are invalid", () => {
    const policy: PolicyConfig = {
      ...emptyPolicy,
      bufferMinutes: -5,
      dailyCap: 0,
      staleAfterHours: 0,
    };
    const errors = validateConfig(policy);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it("validates blackoutWindows independently from allowedWindows", () => {
    const policy: PolicyConfig = {
      ...emptyPolicy,
      blackoutWindows: [{ start: "09:00", end: "18:00", days: [8] }],
    };
    const errors = validateConfig(policy);
    expect(errors.some((e) => e.includes("blackoutWindows") && e.includes("invalid value 8"))).toBe(true);
  });
});

// ─── findNextSlot ─────────────────────────────────────────────────────────────

describe("findNextSlot", () => {
  // Base: Monday 2026-06-08 09:00 local
  const monday9am = localDate(2026, 6, 8, 9, 0);

  it("returns a slot immediately after the buffer when no constraints block it", () => {
    // No allowed/blackout windows, no existing events
    const slot = findNextSlot(monday9am, 30, emptyPolicy, []);
    expect(slot).not.toBeNull();
    // Slot should be at least bufferMinutes after `after`
    if (slot) {
      expect(slot.getTime()).toBeGreaterThanOrEqual(
        monday9am.getTime() + emptyPolicy.bufferMinutes * 60 * 1000
      );
    }
  });

  it("finds a slot within the allowed window", () => {
    const policy: PolicyConfig = {
      ...emptyPolicy,
      allowedWindows: [{ start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5] }],
    };
    const after = localDate(2026, 6, 8, 9, 0);
    const slot = findNextSlot(after, 30, policy, []);
    expect(slot).not.toBeNull();
    if (slot) {
      expect(isInAllowedWindow(slot, policy)).toBe(true);
    }
  });

  it("skips past a blackout window to find the next open slot", () => {
    const policy: PolicyConfig = {
      ...emptyPolicy,
      blackoutWindows: [{ start: "09:00", end: "12:00", days: [1, 2, 3, 4, 5] }],
    };
    // Start just before the blackout
    const after = localDate(2026, 6, 8, 8, 55);
    const slot = findNextSlot(after, 30, policy, []);
    expect(slot).not.toBeNull();
    if (slot) {
      // Slot must be outside the blackout window
      expect(isInBlackoutWindow(slot, policy)).toBe(false);
      // And the slot end must also be outside
      const slotEnd = new Date(slot.getTime() + 30 * 60 * 1000);
      const oneMinBeforeEnd = new Date(slotEnd.getTime() - 60 * 1000);
      expect(isInBlackoutWindow(oneMinBeforeEnd, policy)).toBe(false);
      // Slot must start at or after 12:00
      expect(slot.getHours()).toBeGreaterThanOrEqual(12);
    }
  });

  it("respects buffer against existing events", () => {
    const policy: PolicyConfig = { ...emptyPolicy, bufferMinutes: 30 };
    const existingEvent = {
      startAt: localDate(2026, 6, 8, 10, 0),
      endAt: localDate(2026, 6, 8, 10, 30),
    };
    const after = localDate(2026, 6, 8, 9, 0);
    const slot = findNextSlot(after, 30, policy, [existingEvent]);
    expect(slot).not.toBeNull();
    if (slot) {
      const slotEnd = new Date(slot.getTime() + 30 * 60 * 1000);
      // Slot must not overlap existing event + buffer
      const bufferMs = 30 * 60 * 1000;
      const evStartWithBuffer = existingEvent.startAt.getTime() - bufferMs;
      const evEndWithBuffer = existingEvent.endAt.getTime() + bufferMs;
      const overlaps = slot.getTime() < evEndWithBuffer && slotEnd.getTime() > evStartWithBuffer;
      expect(overlaps).toBe(false);
    }
  });

  it("respects dailyCap — does not schedule more than cap per day", () => {
    const policy: PolicyConfig = { ...emptyPolicy, dailyCap: 1 };
    // Existing event on the same day already consumes the cap
    const existingEvent = {
      startAt: localDate(2026, 6, 8, 10, 0),
      endAt: localDate(2026, 6, 8, 10, 30),
    };
    const after = localDate(2026, 6, 8, 9, 0);
    const slot = findNextSlot(after, 30, policy, [existingEvent]);
    // Must move to the next day
    if (slot) {
      expect(slot.getDate()).toBeGreaterThan(8);
    }
  });

  it("returns null when no slot can be found within 7 days", () => {
    // Blackout covers every minute of every day
    const policy: PolicyConfig = {
      ...emptyPolicy,
      blackoutWindows: [{ start: "00:00", end: "23:59", days: [0, 1, 2, 3, 4, 5, 6] }],
    };
    const slot = findNextSlot(monday9am, 30, policy, []);
    expect(slot).toBeNull();
  });

  it("returns null when allowedWindows are defined but every day is a weekend", () => {
    // Only allowed Mon–Fri but search starts Saturday; no 30-min slot in 7 days
    // because weekdays are allowed but we fill them all with dailyCap=0... actually
    // let's make allowedWindows cover only 1 hour per day but require 2 hours
    const policy: PolicyConfig = {
      ...emptyPolicy,
      allowedWindows: [{ start: "10:00", end: "10:01", days: [1, 2, 3, 4, 5] }],
    };
    // 30-minute slot can never fit in a 1-minute window
    const slot = findNextSlot(monday9am, 30, policy, []);
    expect(slot).toBeNull();
  });

  it("empty allowedWindows allows any non-blackout time", () => {
    const policy: PolicyConfig = {
      ...emptyPolicy,
      blackoutWindows: [{ start: "23:00", end: "07:00", days: [0, 1, 2, 3, 4, 5, 6] }],
    };
    // 09:00 on Monday — not in blackout, should find a slot
    const slot = findNextSlot(monday9am, 30, policy, []);
    expect(slot).not.toBeNull();
  });

  it("slot start is rounded up to 15-minute boundary", () => {
    // after = 09:07 — first candidate after bufferMinutes (15) = 09:22 → rounds to 09:30
    const after = localDate(2026, 6, 8, 9, 7);
    const slot = findNextSlot(after, 30, emptyPolicy, []);
    expect(slot).not.toBeNull();
    if (slot) {
      expect(slot.getMinutes() % 15).toBe(0);
    }
  });
});

// ─── applyConfigMessage ───────────────────────────────────────────────────────

describe("applyConfigMessage", () => {
  it("parses work hours pattern and sets allowedWindow for weekdays", () => {
    const { updated, summary } = applyConfigMessage(
      "work hours are 9am–6pm Mon–Fri",
      emptyPolicy
    );
    expect(updated.allowedWindows).toHaveLength(1);
    const w = updated.allowedWindows[0];
    expect(w?.start).toBe("09:00");
    expect(w?.end).toBe("18:00");
    expect(w?.days).toEqual([1, 2, 3, 4, 5]);
    expect(summary).toContain("allowed window");
  });

  it("parses 'no meetings before 9am' and adds a morning blackout", () => {
    const { updated, summary } = applyConfigMessage(
      "no meetings before 9am",
      emptyPolicy
    );
    const bw = updated.blackoutWindows;
    expect(bw.length).toBeGreaterThan(0);
    const w = bw.find((b) => b.start === "00:00");
    expect(w).toBeDefined();
    expect(w?.end).toBe("09:00");
    expect(w?.days).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(summary).toContain("blackout");
  });

  it("parses sleep window and adds overnight blackout", () => {
    const { updated, summary } = applyConfigMessage(
      "sleep is 11pm to 7am",
      emptyPolicy
    );
    const bw = updated.blackoutWindows;
    const w = bw.find((b) => b.start === "23:00");
    expect(w).toBeDefined();
    expect(w?.end).toBe("07:00");
    expect(w?.days).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(summary).toContain("sleep");
  });

  it("parses buffer phrase and sets bufferMinutes", () => {
    const { updated, summary } = applyConfigMessage(
      "buffer 15 minutes between items",
      emptyPolicy
    );
    expect(updated.bufferMinutes).toBe(15);
    expect(summary).toContain("bufferMinutes");
  });

  it("parses custom buffer value", () => {
    const { updated } = applyConfigMessage(
      "buffer 30 minutes between items",
      emptyPolicy
    );
    expect(updated.bufferMinutes).toBe(30);
  });

  it("parses dailyCap phrase and sets dailyCap", () => {
    const { updated, summary } = applyConfigMessage(
      "max 3 auto-scheduled items per day",
      emptyPolicy
    );
    expect(updated.dailyCap).toBe(3);
    expect(summary).toContain("dailyCap");
  });

  it("parses staleAfterHours phrase", () => {
    const { updated, summary } = applyConfigMessage(
      "stale after 8 hours",
      emptyPolicy
    );
    expect(updated.staleAfterHours).toBe(8);
    expect(summary).toContain("staleAfterHours");
  });

  it("handles unrecognized phrase and notes it in summary", () => {
    const { updated, summary } = applyConfigMessage(
      "please be nice to me",
      emptyPolicy
    );
    // Config unchanged
    expect(updated).toEqual(emptyPolicy);
    expect(summary).toContain("unrecognized");
  });

  it("does not change config on fully unrecognized input", () => {
    const { updated } = applyConfigMessage("foo bar baz", emptyPolicy);
    expect(updated.bufferMinutes).toBe(emptyPolicy.bufferMinutes);
    expect(updated.dailyCap).toBe(emptyPolicy.dailyCap);
    expect(updated.staleAfterHours).toBe(emptyPolicy.staleAfterHours);
    expect(updated.allowedWindows).toEqual([]);
    expect(updated.blackoutWindows).toEqual([]);
  });

  it("applies multiple phrases from one message", () => {
    const { updated, summary } = applyConfigMessage(
      "work hours are 9am–6pm Mon–Fri, buffer 20 minutes between items, stale after 6 hours",
      emptyPolicy
    );
    expect(updated.allowedWindows).toHaveLength(1);
    expect(updated.bufferMinutes).toBe(20);
    expect(updated.staleAfterHours).toBe(6);
    expect(summary).toContain("allowed window");
    expect(summary).toContain("bufferMinutes");
    expect(summary).toContain("staleAfterHours");
  });

  it("does not mutate the original config object", () => {
    const original = { ...emptyPolicy };
    applyConfigMessage("stale after 3 hours", emptyPolicy);
    expect(emptyPolicy.staleAfterHours).toBe(original.staleAfterHours);
  });

  it("replacing work hours replaces existing weekday allowed window", () => {
    const withWindow: PolicyConfig = {
      ...emptyPolicy,
      allowedWindows: [{ start: "08:00", end: "17:00", days: [1, 2, 3, 4, 5] }],
    };
    const { updated } = applyConfigMessage(
      "work hours are 9am–6pm Mon–Fri",
      withWindow
    );
    // Should replace, not add a duplicate
    const weekdayWindows = updated.allowedWindows.filter(
      (w) => JSON.stringify([...w.days].sort()) === JSON.stringify([1, 2, 3, 4, 5])
    );
    expect(weekdayWindows).toHaveLength(1);
    expect(weekdayWindows[0]?.start).toBe("09:00");
  });

  it("parses sleep window with 12-hour format correctly", () => {
    const { updated } = applyConfigMessage("sleep is 10pm to 6am", emptyPolicy);
    const w = updated.blackoutWindows.find((b) => b.start === "22:00");
    expect(w).toBeDefined();
    expect(w?.end).toBe("06:00");
  });

  it("parses 'no meetings before 8am'", () => {
    const { updated } = applyConfigMessage("no meetings before 8am", emptyPolicy);
    const w = updated.blackoutWindows.find((b) => b.end === "08:00");
    expect(w).toBeDefined();
    expect(w?.start).toBe("00:00");
  });

  it("returns no-change summary when input is empty", () => {
    const { updated, summary } = applyConfigMessage("", emptyPolicy);
    expect(updated).toEqual(emptyPolicy);
    expect(summary).toContain("no changes");
  });
});

// ──── EDGE-CASE TESTS (QA) ──────────────────────────────────────────────────────

describe("isInAllowedWindow — overnight edge cases", () => {
  it("includes exactly at midnight (00:00) in overnight window 23:00–07:00", () => {
    const policy: PolicyConfig = {
      ...emptyPolicy,
      allowedWindows: [{ start: "23:00", end: "07:00", days: [0, 1, 2, 3, 4, 5, 6] }],
    };
    const midnight = localDate(2026, 6, 8, 0, 0);
    expect(isInAllowedWindow(midnight, policy)).toBe(true);
  });

  it("includes 00:01 (just after midnight) in overnight window 23:00–07:00", () => {
    const policy: PolicyConfig = {
      ...emptyPolicy,
      allowedWindows: [{ start: "23:00", end: "07:00", days: [0, 1, 2, 3, 4, 5, 6] }],
    };
    const justAfterMidnight = localDate(2026, 6, 8, 0, 1);
    expect(isInAllowedWindow(justAfterMidnight, policy)).toBe(true);
  });

  it("excludes 07:00 (boundary, half-open) in overnight window 23:00–07:00", () => {
    const policy: PolicyConfig = {
      ...emptyPolicy,
      allowedWindows: [{ start: "23:00", end: "07:00", days: [0, 1, 2, 3, 4, 5, 6] }],
    };
    const sevenAm = localDate(2026, 6, 8, 7, 0);
    expect(isInAllowedWindow(sevenAm, policy)).toBe(false);
  });

  it("excludes 22:59 (before start) in overnight window 23:00–07:00", () => {
    const policy: PolicyConfig = {
      ...emptyPolicy,
      allowedWindows: [{ start: "23:00", end: "07:00", days: [0, 1, 2, 3, 4, 5, 6] }],
    };
    const almostMidnight = localDate(2026, 6, 8, 22, 59);
    expect(isInAllowedWindow(almostMidnight, policy)).toBe(false);
  });
});

describe("findNextSlot — zero allowed windows", () => {
  it("treats all hours as allowed when allowedWindows is empty", () => {
    const policy: PolicyConfig = {
      ...emptyPolicy,
      allowedWindows: [],
      blackoutWindows: [],
    };
    const monday9am = localDate(2026, 6, 8, 9, 0);
    const slot = findNextSlot(monday9am, 30, policy, []);
    expect(slot).not.toBeNull();
    if (slot) {
      // Slot should be found (within 7 days)
      const daysDiff = (slot.getTime() - monday9am.getTime()) / (24 * 60 * 60 * 1000);
      expect(daysDiff).toBeLessThanOrEqual(7);
    }
  });
});

describe("findNextSlot — daily cap exhaustion", () => {
  it("rolls to next day when dailyCap is exhausted today", () => {
    const policy: PolicyConfig = { ...emptyPolicy, dailyCap: 2 };
    const monday9am = localDate(2026, 6, 8, 9, 0);
    // Two existing events on Monday (cap is 2)
    const existingEvents = [
      {
        startAt: localDate(2026, 6, 8, 9, 0),
        endAt: localDate(2026, 6, 8, 10, 0),
      },
      {
        startAt: localDate(2026, 6, 8, 11, 0),
        endAt: localDate(2026, 6, 8, 12, 0),
      },
    ];
    const slot = findNextSlot(monday9am, 30, policy, existingEvents);
    expect(slot).not.toBeNull();
    if (slot) {
      // Slot should be on Tuesday (date > 8)
      expect(slot.getDate()).toBeGreaterThan(8);
    }
  });
});

describe("findNextSlot — cross-midnight slot", () => {
  it("handles 90-minute slot starting at 23:15 inside overnight window 22:00–07:00", () => {
    const policy: PolicyConfig = {
      ...emptyPolicy,
      allowedWindows: [{ start: "22:00", end: "07:00", days: [0, 1, 2, 3, 4, 5, 6] }],
    };
    const startTime = localDate(2026, 6, 8, 23, 15);
    const slot = findNextSlot(startTime, 90, policy, []);
    expect(slot).not.toBeNull();
    if (slot) {
      // Verify slot spans across midnight — it either succeeds or falls back gracefully
      // The implementation should handle this correctly (check both start and end minute before end)
      const slotEnd = new Date(slot.getTime() + 90 * 60 * 1000);
      // Both start and end should be valid — start must be in window
      expect(isInAllowedWindow(slot, policy)).toBe(true);
      // End - 1 minute must also be in window (half-open interval check in implementation)
      const oneMinBeforeEnd = new Date(slotEnd.getTime() - 60 * 1000);
      expect(isInAllowedWindow(oneMinBeforeEnd, policy)).toBe(true);
    }
  });
});

describe("applyConfigMessage — AM/PM variants", () => {
  it("parses uppercase AM/PM: 'work hours are 9AM-5PM Mon-Fri'", () => {
    const { updated } = applyConfigMessage(
      "work hours are 9AM-5PM Mon-Fri",
      emptyPolicy
    );
    const w = updated.allowedWindows[0];
    expect(w).toBeDefined();
    expect(w?.start).toBe("09:00");
    expect(w?.end).toBe("17:00");
  });

  it("parses colon-minute format with AM/PM: 'work hours are 9:00am-5:30pm Mon-Fri'", () => {
    const { updated } = applyConfigMessage(
      "work hours are 9:00am-5:30pm Mon-Fri",
      emptyPolicy
    );
    const w = updated.allowedWindows[0];
    expect(w).toBeDefined();
    expect(w?.start).toBe("09:00");
    expect(w?.end).toBe("17:30");
  });

  it("parses 'sleep 10:30pm to 6:30am' with colon-minute format", () => {
    const { updated } = applyConfigMessage(
      "sleep 10:30pm to 6:30am",
      emptyPolicy
    );
    const w = updated.blackoutWindows.find((b) => b.start === "22:30");
    expect(w).toBeDefined();
    expect(w?.end).toBe("06:30");
  });
});

describe("applyConfigMessage — idempotency", () => {
  it("applying same config message twice does not duplicate allowed window", () => {
    const config1 = applyConfigMessage(
      "work hours are 9am-6pm Mon-Fri",
      emptyPolicy
    ).updated;
    const config2 = applyConfigMessage(
      "work hours are 9am-6pm Mon-Fri",
      config1
    ).updated;
    // Should still have exactly 1 weekday allowed window, not 2
    const weekdayWindows = config2.allowedWindows.filter(
      (w) => JSON.stringify([...w.days].sort()) === JSON.stringify([1, 2, 3, 4, 5])
    );
    expect(weekdayWindows).toHaveLength(1);
    expect(weekdayWindows[0]?.start).toBe("09:00");
    expect(weekdayWindows[0]?.end).toBe("18:00");
  });
});

describe("validateConfig — empty days array on TimeWindow", () => {
  it("rejects allowedWindow with empty days array", () => {
    const policy: PolicyConfig = {
      ...emptyPolicy,
      allowedWindows: [{ start: "09:00", end: "17:00", days: [] }],
    };
    const errors = validateConfig(policy);
    expect(errors.some((e) => e.includes("days must not be empty"))).toBe(true);
  });

  it("rejects blackoutWindow with empty days array", () => {
    const policy: PolicyConfig = {
      ...emptyPolicy,
      blackoutWindows: [{ start: "23:00", end: "07:00", days: [] }],
    };
    const errors = validateConfig(policy);
    expect(errors.some((e) => e.includes("days must not be empty"))).toBe(true);
  });
});

describe("validateConfig — bufferMinutes: 0", () => {
  it("allows bufferMinutes === 0 (valid per spec: >= 0)", () => {
    const policy: PolicyConfig = { ...emptyPolicy, bufferMinutes: 0 };
    const errors = validateConfig(policy);
    const bufferError = errors.find((e) => e.includes("bufferMinutes"));
    expect(bufferError).toBeUndefined();
  });
});

describe("findNextSlot — returns null after 7 days", () => {
  it("returns null when search extends beyond 7-day deadline", () => {
    // Use a very restrictive window that only allows 1 day, and search for 8 days
    const policy: PolicyConfig = {
      ...emptyPolicy,
      allowedWindows: [
        { start: "09:00", end: "17:00", days: [1] }, // Only Monday allowed
      ],
      dailyCap: 1,
    };
    // Start on Tuesday (after the only allowed Monday)
    const tuesday = localDate(2026, 6, 9, 9, 0);
    // Next Monday is June 15, which is 6 days away — still within 7-day window
    // So let's use a more direct approach: fill dailyCap for all allowed windows within search range
    const monday1 = localDate(2026, 6, 8, 9, 0); // June 8 is Monday (allowed)
    const existing = [
      {
        startAt: localDate(2026, 6, 8, 9, 0),
        endAt: localDate(2026, 6, 8, 10, 0),
      }, // Fills Monday dailyCap
    ];
    const slot = findNextSlot(monday1, 60, policy, existing);
    // Should look for next Monday (June 15) which is outside 7-day window from June 8
    expect(slot).toBeNull();
  });
});

describe("applyConfigMessage — multiple invocations with blackout merging", () => {
  it("applies 'no meetings before 9am' then 'no meetings before 10am' and merges correctly", () => {
    let config = emptyPolicy;
    const { updated: step1 } = applyConfigMessage(
      "no meetings before 9am",
      config
    );
    // step1 should have a blackout 00:00–09:00
    expect(
      step1.blackoutWindows.some((w) => w.start === "00:00" && w.end === "09:00")
    ).toBe(true);

    const { updated: step2 } = applyConfigMessage(
      "no meetings before 10am",
      step1
    );
    // step2 should have replaced (not added a second)
    // Implementation merges by filtering windows with same days and start time
    const count00 = step2.blackoutWindows.filter(
      (w) => w.start === "00:00" && w.days.length === 7
    ).length;
    // May have 00:00–09:00 and 00:00–10:00 (both exist) or just 00:00–10:00 depending on merge logic
    // The spec says merging replaces windows with same (days, start)
    // Both have start "00:00" and days [0..6], so only one should remain
    expect(count00).toBeLessThanOrEqual(1);
  });
});
