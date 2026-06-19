import { readCalendarMirror } from "./storage.js";
import { undoCalendarEntry } from "./plan.js";
import type { CalendarMirrorEntry } from "./types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true when the ISO-8601 string `iso` falls on the same local calendar
 * date as `today`.
 */
function isSameLocalDate(iso: string, today: string): boolean {
  // Slice the YYYY-MM-DD portion of the local date representation.
  // new Date(iso) is in UTC; toLocaleDateString with ISO-like output is
  // locale-dependent, so we format manually using local getFullYear/Month/Date.
  const d = new Date(iso);
  const y = d.getFullYear().toString().padStart(4, "0");
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}` === today;
}

/** Returns today's date as "YYYY-MM-DD" in local time. */
function localToday(): string {
  const now = new Date();
  const y = now.getFullYear().toString().padStart(4, "0");
  const m = (now.getMonth() + 1).toString().padStart(2, "0");
  const d = now.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the full audit trail: all CalendarMirrorEntries, newest first.
 * All filter options are optional and AND-combined.
 */
export function getAuditTrail(filter?: {
  tier?: 0 | 1 | 2 | 3;
  undone?: boolean;
  since?: Date;
  until?: Date;
}): CalendarMirrorEntry[] {
  const mirror = readCalendarMirror();

  const sorted = mirror
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (!filter) return sorted;

  return sorted.filter((entry) => {
    if (filter.tier !== undefined && entry.tier !== filter.tier) return false;
    if (filter.undone !== undefined && entry.undone !== filter.undone) return false;
    const createdMs = new Date(entry.createdAt).getTime();
    if (filter.since !== undefined && createdMs < filter.since.getTime()) return false;
    if (filter.until !== undefined && createdMs > filter.until.getTime()) return false;
    return true;
  });
}

/**
 * Undoes the most recent non-undone calendar change.
 * Delegates the actual Apple Calendar mutation to plan.undoCalendarEntry.
 * Returns the entry that was undone, or null when there are no active entries.
 */
export async function undoLast(): Promise<CalendarMirrorEntry | null> {
  const active = getAuditTrail({ undone: false });
  if (active.length === 0) return null;

  // getAuditTrail returns newest-first; first element is the most recent.
  // noUncheckedIndexedAccess requires the non-null assertion — the length
  // guard above guarantees the array is non-empty.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const entry = active[0]!;
  await undoCalendarEntry(entry.id);
  // Re-read the mirror so the returned entry reflects the undone: true state
  // written by undoCalendarEntry — returning the pre-undo local variable would
  // give callers a stale undone: false snapshot.
  const updated = readCalendarMirror().find((e) => e.id === entry.id);
  return updated ?? entry;
}

/**
 * Undoes a specific calendar entry by mirror ID.
 * Throws if the entry is not found or is already undone.
 */
export async function undoById(mirrorId: string): Promise<CalendarMirrorEntry> {
  const mirror = readCalendarMirror();
  const entry = mirror.find((e) => e.id === mirrorId);

  if (!entry) {
    throw new Error(`entry not found: ${mirrorId}`);
  }
  if (entry.undone) {
    throw new Error(`entry already undone: ${mirrorId}`);
  }

  await undoCalendarEntry(entry.id);
  // Re-read the mirror so the returned entry reflects the undone: true state
  // written by undoCalendarEntry — returning the pre-undo local variable would
  // give callers a stale undone: false snapshot.
  const updated = readCalendarMirror().find((e) => e.id === entry.id);
  return updated ?? entry;
}

/**
 * Returns all calendar changes made today (local time), newest first.
 */
export function getTodaysChanges(): CalendarMirrorEntry[] {
  const today = localToday();
  return getAuditTrail().filter((entry) => isSameLocalDate(entry.createdAt, today));
}

/**
 * Returns the count of Tier 2 auto-scheduled items created today that have
 * not been undone — used to enforce the dailyCap policy.
 */
export function getTier2CountToday(): number {
  const today = localToday();
  return readCalendarMirror().filter(
    (e) => e.tier === 2 && !e.undone && isSameLocalDate(e.createdAt, today),
  ).length;
}

// ─── Formatting ───────────────────────────────────────────────────────────────

const FORMAT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const FORMAT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * Formats a CalendarMirrorEntry as a human-readable one-line summary.
 *
 * Example outputs:
 *   "[Event] Dentist — Thu Jun 5 at 3:00pm (Tier 1) ✓ active"
 *   "[Reminder] Take meds — Fri Jun 6 at 9:00am (Tier 2) ✗ undone"
 */
export function formatEntry(entry: CalendarMirrorEntry): string {
  const type = entry.isReminder ? "[Reminder]" : "[Event]";

  const d = new Date(entry.startAt);
  const weekday = FORMAT_WEEKDAYS[d.getDay()];
  const month = FORMAT_MONTHS[d.getMonth()];
  const day = d.getDate();
  const rawHours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, "0");
  const ampm = rawHours < 12 ? "am" : "pm";
  const hours = rawHours === 0 ? 12 : rawHours > 12 ? rawHours - 12 : rawHours;
  const dateStr = `${weekday} ${month} ${day} at ${hours}:${minutes}${ampm}`;

  const status = entry.undone
    ? "✗ undone"
    : entry.completedByUser
      ? "✓ completed by user"
      : "✓ active";

  return `${type} ${entry.title} — ${dateStr} (Tier ${entry.tier}) ${status}`;
}
