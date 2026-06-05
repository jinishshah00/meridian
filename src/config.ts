import type { PolicyConfig, TimeWindow } from "./types.js";

// ─── Time helpers ─────────────────────────────────────────────────────────────

/**
 * Parse an HH:MM string into total minutes since midnight (0–1439).
 */
function hmToMinutes(hm: string): number {
  const [hStr, mStr] = hm.split(":");
  return parseInt(hStr ?? "0", 10) * 60 + parseInt(mStr ?? "0", 10);
}

/**
 * Return the total minutes since midnight for a given Date in local time.
 */
function dateToMinutes(dt: Date): number {
  return dt.getHours() * 60 + dt.getMinutes();
}

/**
 * Return whether `minutesOfDay` falls within the time range [start, end) of a
 * TimeWindow. Handles overnight windows where end < start (e.g. 23:00–07:00).
 */
function minutesInTimeRange(minutesOfDay: number, start: number, end: number): boolean {
  if (start <= end) {
    // Normal window: e.g. 09:00–18:00
    return minutesOfDay >= start && minutesOfDay < end;
  }
  // Overnight window: e.g. 23:00–07:00 — active from start to midnight AND midnight to end
  return minutesOfDay >= start || minutesOfDay < end;
}

/**
 * Return whether a given Date (in local time) falls inside any window from
 * the provided array. Returns false immediately when the array is empty.
 */
function isInWindowList(dt: Date, windows: TimeWindow[]): boolean {
  if (windows.length === 0) return false;
  const dayOfWeek = dt.getDay(); // 0=Sun, 6=Sat
  const minutesOfDay = dateToMinutes(dt);
  return windows.some((w) => {
    if (!w.days.includes(dayOfWeek)) return false;
    const startMin = hmToMinutes(w.start);
    const endMin = hmToMinutes(w.end);
    return minutesInTimeRange(minutesOfDay, startMin, endMin);
  });
}

// ─── Public window checks ─────────────────────────────────────────────────────

/** Return true when `dt` falls inside at least one allowed window. */
export function isInAllowedWindow(dt: Date, config: PolicyConfig): boolean {
  return isInWindowList(dt, config.allowedWindows);
}

/** Return true when `dt` falls inside at least one blackout window. */
export function isInBlackoutWindow(dt: Date, config: PolicyConfig): boolean {
  return isInWindowList(dt, config.blackoutWindows);
}

// ─── Validation ───────────────────────────────────────────────────────────────

/** Return a list of validation error strings. Empty array means valid. */
export function validateConfig(config: PolicyConfig): string[] {
  const errors: string[] = [];

  if (config.bufferMinutes < 0) {
    errors.push("bufferMinutes must be >= 0");
  }
  if (config.dailyCap < 1) {
    errors.push("dailyCap must be >= 1");
  }
  if (config.staleAfterHours <= 0) {
    errors.push("staleAfterHours must be > 0");
  }

  const validateWindows = (windows: TimeWindow[], label: string): void => {
    windows.forEach((w, i) => {
      if (w.days.length === 0) {
        errors.push(`${label}[${i}].days must not be empty`);
      }
      w.days.forEach((d) => {
        if (d < 0 || d > 6) {
          errors.push(`${label}[${i}].days contains invalid value ${d} (must be 0–6)`);
        }
      });
      const startMin = hmToMinutes(w.start);
      const endMin = hmToMinutes(w.end);
      if (startMin === endMin) {
        errors.push(`${label}[${i}]: start and end must differ (got ${w.start})`);
      }
    });
  };

  validateWindows(config.allowedWindows, "allowedWindows");
  validateWindows(config.blackoutWindows, "blackoutWindows");

  return errors;
}

// ─── Slot finder ──────────────────────────────────────────────────────────────

const STEP_MINUTES = 15;
const SEARCH_DAYS = 7;

/**
 * Find the next available slot of `durationMinutes` starting after `after`,
 * respecting allowed/blackout windows, event buffer, and dailyCap.
 * Returns null if no slot is found within the next 7 days.
 */
export function findNextSlot(
  after: Date,
  durationMinutes: number,
  config: PolicyConfig,
  existingEvents: Array<{ startAt: Date; endAt: Date }>
): Date | null {
  const deadlineMs = after.getTime() + SEARCH_DAYS * 24 * 60 * 60 * 1000;

  // Count how many slots have already been auto-scheduled per calendar day.
  // Key: "YYYY-MM-DD" in local time.
  const dailyUsage = new Map<string, number>();
  for (const ev of existingEvents) {
    const key = localDateKey(ev.startAt);
    dailyUsage.set(key, (dailyUsage.get(key) ?? 0) + 1);
  }

  // Start from `after` + bufferMinutes, rounded up to next 15-min boundary.
  let candidateMs =
    after.getTime() + config.bufferMinutes * 60 * 1000;
  // Round up to next 15-minute boundary.
  const stepMs = STEP_MINUTES * 60 * 1000;
  const remainder = candidateMs % stepMs;
  if (remainder !== 0) {
    candidateMs += stepMs - remainder;
  }

  while (candidateMs < deadlineMs) {
    const slotStart = new Date(candidateMs);
    const slotEnd = new Date(candidateMs + durationMinutes * 60 * 1000);

    if (isSlotValid(slotStart, slotEnd, config, existingEvents, dailyUsage)) {
      return slotStart;
    }

    candidateMs += stepMs;
  }

  return null;
}

/**
 * Return true when the slot [slotStart, slotEnd) passes all scheduling checks.
 */
function isSlotValid(
  slotStart: Date,
  slotEnd: Date,
  config: PolicyConfig,
  existingEvents: Array<{ startAt: Date; endAt: Date }>,
  dailyUsage: Map<string, number>
): boolean {
  // 1. Allowed windows: if any are defined, the slot must be fully inside one.
  if (config.allowedWindows.length > 0) {
    // Every minute of the slot must be in an allowed window.  We check the
    // start and the minute immediately before the end (since windows are
    // half-open, [start, end)).
    if (!isInAllowedWindow(slotStart, config)) return false;
    const oneMinBeforeEnd = new Date(slotEnd.getTime() - 60 * 1000);
    if (!isInAllowedWindow(oneMinBeforeEnd, config)) return false;
  }

  // 2. Blackout windows: no part of the slot may fall in a blackout.
  if (isInBlackoutWindow(slotStart, config)) return false;
  const oneMinBeforeEnd = new Date(slotEnd.getTime() - 60 * 1000);
  if (isInBlackoutWindow(oneMinBeforeEnd, config)) return false;

  // 3. Existing events: slot must not overlap any event, with buffer applied.
  const bufferMs = config.bufferMinutes * 60 * 1000;
  for (const ev of existingEvents) {
    const evStartWithBuffer = ev.startAt.getTime() - bufferMs;
    const evEndWithBuffer = ev.endAt.getTime() + bufferMs;
    const overlaps =
      slotStart.getTime() < evEndWithBuffer &&
      slotEnd.getTime() > evStartWithBuffer;
    if (overlaps) return false;
  }

  // 4. Daily cap: the day of slotStart must not have reached dailyCap yet.
  const dayKey = localDateKey(slotStart);
  const usedToday = dailyUsage.get(dayKey) ?? 0;
  if (usedToday >= config.dailyCap) return false;

  return true;
}

/**
 * Return a "YYYY-MM-DD" string for a Date in local time, used as a dailyCap key.
 */
function localDateKey(dt: Date): string {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ─── Natural-language config parser ──────────────────────────────────────────

/**
 * Apply a natural-language configuration message and update PolicyConfig.
 * Returns the updated config and a human-readable summary of what changed.
 * Uses regex pattern matching — no Claude API calls.
 */
export function applyConfigMessage(
  rawText: string,
  current: PolicyConfig
): { updated: PolicyConfig; summary: string } {
  const updated: PolicyConfig = JSON.parse(JSON.stringify(current)) as PolicyConfig;
  const changes: string[] = [];
  let remaining = rawText.trim();

  // ── Pattern 1: work hours "9am–6pm Mon–Fri" (or "Monday–Friday", "M-F", etc.)
  {
    const m = remaining.match(
      /work\s+hours?\s+(?:are\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?[–\-–to]+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(?:mon(?:day)?[–\-–to]+fri(?:day)?|m[–\-–]?f)/i
    );
    if (m) {
      const startH = parseHour(m[1] ?? "9", m[2] ?? "00", m[3]);
      const endH = parseHour(m[4] ?? "18", m[5] ?? "00", m[6]);
      const window: TimeWindow = {
        start: startH,
        end: endH,
        days: [1, 2, 3, 4, 5],
      };
      updated.allowedWindows = [
        ...updated.allowedWindows.filter(
          (w) => !arraysEqual(w.days, [1, 2, 3, 4, 5])
        ),
        window,
      ];
      changes.push(`set allowed window ${startH}–${endH} Mon–Fri`);
      remaining = remaining.replace(m[0], "").trim();
    }
  }

  // ── Pattern 2: "no meetings before 9am"
  {
    const m = remaining.match(/no\s+meetings?\s+before\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (m) {
      const cutoff = parseHour(m[1] ?? "9", m[2] ?? "00", m[3]);
      const window: TimeWindow = { start: "00:00", end: cutoff, days: ALL_DAYS };
      updated.blackoutWindows = mergeBlackout(updated.blackoutWindows, window);
      changes.push(`added blackout 00:00–${cutoff} every day (no meetings before ${cutoff})`);
      remaining = remaining.replace(m[0], "").trim();
    }
  }

  // ── Pattern 3: "sleep is 11pm to 7am"
  {
    const m = remaining.match(
      /sleep\s+(?:is\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+to\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i
    );
    if (m) {
      const sleepStart = parseHour(m[1] ?? "23", m[2] ?? "00", m[3]);
      const sleepEnd = parseHour(m[4] ?? "7", m[5] ?? "00", m[6]);
      const window: TimeWindow = { start: sleepStart, end: sleepEnd, days: ALL_DAYS };
      updated.blackoutWindows = mergeBlackout(updated.blackoutWindows, window);
      changes.push(`added blackout ${sleepStart}–${sleepEnd} every day (sleep window)`);
      remaining = remaining.replace(m[0], "").trim();
    }
  }

  // ── Pattern 4: "buffer 15 minutes between items"
  {
    const m = remaining.match(/buffer\s+(\d+)\s+min(?:utes?)?\s+(?:between\s+items?|gap)?/i);
    if (m) {
      const mins = parseInt(m[1] ?? "15", 10);
      updated.bufferMinutes = mins;
      changes.push(`set bufferMinutes to ${mins}`);
      remaining = remaining.replace(m[0], "").trim();
    }
  }

  // ── Pattern 5: "max 3 auto-scheduled items per day"
  {
    const m = remaining.match(
      /max(?:imum)?\s+(\d+)\s+auto[- ]?scheduled\s+items?\s+per\s+day/i
    );
    if (m) {
      const cap = parseInt(m[1] ?? "5", 10);
      updated.dailyCap = cap;
      changes.push(`set dailyCap to ${cap}`);
      remaining = remaining.replace(m[0], "").trim();
    }
  }

  // ── Pattern 6: "stale after 8 hours"
  {
    const m = remaining.match(/stale\s+after\s+(\d+)\s+hours?/i);
    if (m) {
      const hours = parseInt(m[1] ?? "12", 10);
      updated.staleAfterHours = hours;
      changes.push(`set staleAfterHours to ${hours}`);
      remaining = remaining.replace(m[0], "").trim();
    }
  }

  // ── Leftover text that matched no known pattern
  const leftover = remaining.replace(/[,;.\s]+/g, " ").trim();
  if (leftover.length > 0) {
    changes.push(`unrecognized: "${leftover}"`);
  }

  const summary =
    changes.length > 0
      ? changes.join("; ")
      : "no changes — no recognized configuration phrases found";

  return { updated, summary };
}

// ─── applyConfigMessage helpers ───────────────────────────────────────────────

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/**
 * Convert a parsed hour + minute + am/pm suffix into an HH:MM string.
 * When no suffix is given, the raw number is used as-is (24-hour assumed).
 */
function parseHour(hour: string, minute: string, suffix: string | undefined): string {
  let h = parseInt(hour, 10);
  const m = parseInt(minute, 10);
  if (suffix) {
    const s = suffix.toLowerCase();
    if (s === "am" && h === 12) h = 0;
    if (s === "pm" && h !== 12) h += 12;
  }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sorted_a = [...a].sort((x, y) => x - y);
  const sorted_b = [...b].sort((x, y) => x - y);
  return sorted_a.every((v, i) => v === sorted_b[i]);
}

/**
 * Add a blackout window, replacing any existing window with the same days array
 * and the same start time to avoid duplicates on repeated config application.
 */
function mergeBlackout(existing: TimeWindow[], incoming: TimeWindow): TimeWindow[] {
  const filtered = existing.filter(
    (w) => !(arraysEqual(w.days, incoming.days) && w.start === incoming.start)
  );
  return [...filtered, incoming];
}
