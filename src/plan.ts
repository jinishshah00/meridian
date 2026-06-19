import { randomUUID } from "crypto";
import { readCalendarMirror, writeCalendarMirror } from "./storage.js";
import type { CalendarMirrorEntry } from "./types.js";

// ─── AppleScript date format ──────────────────────────────────────────────────

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Formats a Date into the literal string AppleScript's `date` constructor
 * expects: "Weekday, Month D, YYYY at H:MM:SS AM/PM"
 *
 * AppleScript date parsing is locale-sensitive on the host machine, but this
 * long-form format works on any English-locale macOS (the default for most
 * developer Macs). Chosen over epoch seconds to keep scripts human-readable in
 * logs and audit trails.
 */
export function formatAppleScriptDate(d: Date): string {
  const weekday = WEEKDAYS[d.getDay()];
  const month = MONTHS[d.getMonth()];
  const day = d.getDate();
  const year = d.getFullYear();
  let hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, "0");
  const seconds = d.getSeconds().toString().padStart(2, "0");
  const ampm = hours < 12 ? "AM" : "PM";
  if (hours === 0) hours = 12;
  else if (hours > 12) hours -= 12;
  return `${weekday}, ${month} ${day}, ${year} at ${hours}:${minutes}:${seconds} ${ampm}`;
}

// ─── Pure AppleScript builders ────────────────────────────────────────────────

/**
 * Returns the AppleScript to create a Calendar event.
 * The script echoes the new event's uid to stdout so callers can capture the
 * externalId.
 */
export function buildCreateEventScript(params: {
  title: string;
  startAt: Date;
  endAt: Date;
  calendarName: string;
}): string {
  const { title, startAt, endAt, calendarName } = params;
  const escapedTitle = title.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const escapedCal = calendarName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return [
    `tell application "Calendar"`,
    `  tell calendar "${escapedCal}"`,
    `    set newEvent to make new event with properties {summary:"${escapedTitle}", start date:date "${formatAppleScriptDate(startAt)}", end date:date "${formatAppleScriptDate(endAt)}"}`,
    `    return uid of newEvent`,
    `  end tell`,
    `end tell`,
  ].join("\n");
}

/**
 * Returns the AppleScript to create a Reminder.
 * The script echoes the new reminder's id to stdout.
 */
export function buildCreateReminderScript(params: {
  title: string;
  dueAt: Date;
  listName: string;
}): string {
  const { title, dueAt, listName } = params;
  const escapedTitle = title.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const escapedList = listName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return [
    `tell application "Reminders"`,
    `  tell list "${escapedList}"`,
    `    set newReminder to make new reminder with properties {name:"${escapedTitle}", remind me date:date "${formatAppleScriptDate(dueAt)}"}`,
    `    return id of newReminder`,
    `  end tell`,
    `end tell`,
  ].join("\n");
}

/**
 * Returns the AppleScript to fetch events for the next `days` days from the
 * default (first) calendar.
 *
 * Output format — one line per event, pipe-delimited:
 *   uid||summary||startDate||endDate
 *
 * AppleScript date coercion to string uses the host locale, so we coerce via
 * `time to GMT offset` arithmetic to produce an epoch-second integer that is
 * locale-independent. Callers parse the integer back into a Date.
 */
export function buildGetEventsScript(days: number): string {
  return [
    `tell application "Calendar"`,
    `  set startBound to current date`,
    `  set endBound to startBound + (${days} * days)`,
    `  set resultLines to {}`,
    `  repeat with cal in calendars`,
    `    set evts to (every event of cal whose start date >= startBound and start date <= endBound)`,
    `    repeat with evt in evts`,
    `      set evtUid to uid of evt`,
    `      set evtSummary to summary of evt`,
    `      set evtStart to (start date of evt - (time to GMT)) + 978307200`,
    `      set evtEnd to (end date of evt - (time to GMT)) + 978307200`,
    `      set end of resultLines to (evtUid & "||" & evtSummary & "||" & evtStart & "||" & evtEnd)`,
    `    end repeat`,
    `  end repeat`,
    `  return resultLines as string`,
    `end tell`,
  ].join("\n");
}

/**
 * Returns the AppleScript to delete a Calendar event by uid.
 */
export function buildDeleteEventScript(externalId: string): string {
  const escaped = externalId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return [
    `tell application "Calendar"`,
    `  repeat with cal in calendars`,
    `    set matchedEvents to (every event of cal whose uid is "${escaped}")`,
    `    if (count of matchedEvents) > 0 then`,
    `      delete item 1 of matchedEvents`,
    `      return "deleted"`,
    `    end if`,
    `  end repeat`,
    `  return "not-found"`,
    `end tell`,
  ].join("\n");
}

/**
 * Returns the AppleScript that fetches the IDs of all incomplete reminders
 * across every list. Output is AppleScript's default list-to-string coercion:
 * items joined by ", " (handled by the caller).
 */
export function buildGetIncompleteReminderIdsScript(): string {
  return [
    `tell application "Reminders"`,
    `  set incompleteIds to {}`,
    `  repeat with lst in lists`,
    `    set activeReminders to (every reminder of lst whose completed is false)`,
    `    repeat with r in activeReminders`,
    `      set end of incompleteIds to (id of r)`,
    `    end repeat`,
    `  end repeat`,
    `  return incompleteIds`,
    `end tell`,
  ].join("\n");
}

/**
 * Returns the AppleScript to delete a Reminder by its id.
 */
export function buildDeleteReminderScript(externalId: string): string {
  const escaped = externalId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return [
    `tell application "Reminders"`,
    `  repeat with lst in lists`,
    `    set matchedReminders to (every reminder of lst whose id is "${escaped}")`,
    `    if (count of matchedReminders) > 0 then`,
    `      delete item 1 of matchedReminders`,
    `      return "deleted"`,
    `    end if`,
    `  end repeat`,
    `  return "not-found"`,
    `end tell`,
  ].join("\n");
}

// ─── osascript runner ─────────────────────────────────────────────────────────

/**
 * Executes an AppleScript string via `osascript -e`.
 * Throws a descriptive error on non-zero exit so callers are never silently
 * left with a partial state.
 */
export async function runOsascript(script: string): Promise<string> {
  const proc = Bun.spawn(["osascript", "-e", script], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, stdoutText, stderrText] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  if (exitCode !== 0) {
    const detail = stderrText.trim() || "no stderr output";
    throw new Error(`osascript exited with code ${exitCode}: ${detail}`);
  }

  return stdoutText.trim();
}

// ─── Default calendar / list resolution ──────────────────────────────────────

async function resolveCalendarName(name?: string): Promise<string> {
  if (name) return name;
  // Ask Calendar for the name of the first calendar (the default)
  const script = [
    `tell application "Calendar"`,
    `  return name of first calendar`,
    `end tell`,
  ].join("\n");
  return runOsascript(script);
}

async function resolveListName(name?: string): Promise<string> {
  if (name) return name;
  const script = [
    `tell application "Reminders"`,
    `  return name of first list`,
    `end tell`,
  ].join("\n");
  return runOsascript(script);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Creates a Calendar event.
 * Tier 1 = propose (caller confirms before writing); Tier 2 = auto-create.
 * Both tiers write to Apple Calendar identically — the tier field only signals
 * the autonomy level that authorised the action (stored in the mirror for audit).
 */
export async function createCalendarEvent(params: {
  title: string;
  startAt: Date;
  endAt: Date;
  tier: 1 | 2;
  calendarName?: string;
}): Promise<CalendarMirrorEntry> {
  const { title, startAt, endAt, tier, calendarName } = params;
  const resolvedCal = await resolveCalendarName(calendarName);

  const script = buildCreateEventScript({ title, startAt, endAt, calendarName: resolvedCal });
  const externalId = await runOsascript(script);

  const entry: CalendarMirrorEntry = {
    id: randomUUID(),
    externalId,
    title,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    isReminder: false,
    tier,
    createdAt: new Date().toISOString(),
    undone: false,
  };

  const mirror = readCalendarMirror();
  mirror.push(entry);
  writeCalendarMirror(mirror);

  return entry;
}

/**
 * Creates a Reminder (point alert with no end time).
 */
export async function createReminder(params: {
  title: string;
  dueAt: Date;
  tier: 1 | 2;
  listName?: string;
}): Promise<CalendarMirrorEntry> {
  const { title, dueAt, tier, listName } = params;
  const resolvedList = await resolveListName(listName);

  const script = buildCreateReminderScript({ title, dueAt, listName: resolvedList });
  const externalId = await runOsascript(script);

  const entry: CalendarMirrorEntry = {
    id: randomUUID(),
    externalId,
    title,
    startAt: dueAt.toISOString(),
    isReminder: true,
    tier,
    createdAt: new Date().toISOString(),
    undone: false,
  };

  const mirror = readCalendarMirror();
  mirror.push(entry);
  writeCalendarMirror(mirror);

  return entry;
}

// ─── Parsed event line type (internal) ───────────────────────────────────────

type ParsedEvent = {
  externalId: string;
  title: string;
  startAt: Date;
  endAt: Date;
};

/**
 * Parses the pipe-delimited output lines from `buildGetEventsScript`.
 * Lines that do not match the expected format are silently dropped — AppleScript
 * sometimes emits empty lines between items.
 */
export function parseEventLines(raw: string): ParsedEvent[] {
  // AppleScript joins the list items with ", " when coerced to string.
  // Split on ", " but only if the segment looks like a uid||... record.
  const lines = raw.split(", ").map((l) => l.trim()).filter((l) => l.includes("||"));
  const results: ParsedEvent[] = [];

  for (const line of lines) {
    const parts = line.split("||");
    if (parts.length < 4) continue;
    const [externalId, title, startEpochStr, endEpochStr] = parts as [string, string, string, string];
    const startEpoch = parseInt(startEpochStr, 10);
    const endEpoch = parseInt(endEpochStr, 10);
    if (isNaN(startEpoch) || isNaN(endEpoch)) continue;
    // AppleScript epoch is seconds since 2001-01-01; Unix epoch is 1970-01-01.
    // Difference = 978307200 seconds.
    results.push({
      externalId,
      title,
      startAt: new Date((startEpoch - 978307200) * 1000),
      endAt: new Date((endEpoch - 978307200) * 1000),
    });
  }

  return results;
}

/**
 * Reads upcoming events from Apple Calendar for the next `days` days.
 * Returns them as CalendarMirrorEntry objects (without writing to the mirror —
 * reads are non-mutating).
 */
export async function getUpcomingEvents(days: number): Promise<CalendarMirrorEntry[]> {
  const script = buildGetEventsScript(days);
  const raw = await runOsascript(script);
  if (!raw) return [];

  const parsed = parseEventLines(raw);
  return parsed.map((evt) => ({
    id: randomUUID(),
    externalId: evt.externalId,
    title: evt.title,
    startAt: evt.startAt.toISOString(),
    endAt: evt.endAt.toISOString(),
    isReminder: false,
    // Tier 0 = read-only observation; no autonomy action taken
    tier: 0,
    createdAt: new Date().toISOString(),
    undone: false,
  }));
}

/**
 * Returns true if any existing Calendar event overlaps the proposed window.
 * Uses the mirror for conflict detection when osascript is unavailable, and
 * falls back to live Calendar query otherwise.
 */
export async function hasConflict(startAt: Date, endAt: Date): Promise<boolean> {
  // Fetch live events covering the same day (±1 day buffer for overnight events)
  const days = Math.max(
    1,
    Math.ceil((endAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) + 1,
  );
  const events = await getUpcomingEvents(days);
  return eventsOverlapWindow(events, startAt, endAt);
}

/**
 * Pure overlap check — extracted so it can be unit tested without osascript.
 * Returns true if any entry's time window overlaps [startAt, endAt).
 */
export function eventsOverlapWindow(
  events: Pick<CalendarMirrorEntry, "startAt" | "endAt" | "isReminder">[],
  startAt: Date,
  endAt: Date,
): boolean {
  for (const evt of events) {
    if (evt.isReminder) continue; // reminders have no duration, skip for conflict
    const evtStart = new Date(evt.startAt).getTime();
    const evtEnd = evt.endAt ? new Date(evt.endAt).getTime() : evtStart;
    // Standard interval overlap: two intervals [a,b) and [c,d) overlap iff a<d && c<b
    if (evtStart < endAt.getTime() && startAt.getTime() < evtEnd) {
      return true;
    }
  }
  return false;
}

/**
 * Undoes a calendar change: deletes the event/reminder from Apple Calendar or
 * Reminders, then marks the mirror entry as undone.
 *
 * If the externalId is not found in Apple Calendar (e.g. manually deleted), a
 * warning is logged but no error is thrown — the mirror entry is still marked
 * undone so it is not re-attempted.
 */
export async function undoCalendarEntry(mirrorId: string): Promise<void> {
  const mirror = readCalendarMirror();
  const idx = mirror.findIndex((e) => e.id === mirrorId);
  if (idx === -1) {
    throw new Error(`undoCalendarEntry: no mirror entry found with id "${mirrorId}"`);
  }

  const entry = mirror[idx];
  // idx is already bounds-checked above, so `entry` is defined.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const safeEntry = entry!;

  if (safeEntry.undone) {
    // Already undone — idempotent, nothing to do.
    return;
  }

  const script = safeEntry.isReminder
    ? buildDeleteReminderScript(safeEntry.externalId)
    : buildDeleteEventScript(safeEntry.externalId);

  const result = await runOsascript(script).catch((err: unknown) => {
    // osascript can fail if Calendar is not running or permission is denied.
    // Still mark the entry undone in the mirror to avoid re-attempts.
    console.warn(`undoCalendarEntry: osascript error for ${safeEntry.externalId}:`, err);
    return "not-found";
  });

  if (result === "not-found") {
    console.warn(
      `undoCalendarEntry: externalId "${safeEntry.externalId}" not found in Calendar/Reminders — mirror entry marked undone anyway`,
    );
  }

  // Mirror update: mark undone regardless of whether Apple Calendar confirmed deletion.
  const updated: CalendarMirrorEntry = { ...safeEntry, undone: true };
  mirror[idx] = updated;
  writeCalendarMirror(mirror);
}

/**
 * Queries the Reminders app for all currently incomplete reminders and
 * reconciles the mirror: any reminder entry whose externalId is no longer in
 * the incomplete set is marked `completedByUser` with the current timestamp.
 *
 * Returns the number of mirror entries newly marked as completed.
 */
export async function syncReminderCompletions(): Promise<number> {
  const mirror = readCalendarMirror();
  const activeReminderEntries = mirror.filter(
    (e) => e.isReminder && !e.undone && !e.completedByUser,
  );
  if (activeReminderEntries.length === 0) return 0;

  const script = buildGetIncompleteReminderIdsScript();
  const raw = await runOsascript(script);
  // AppleScript coerces a list to string by joining items with ", "
  const incompleteIds = new Set(
    raw ? raw.split(", ").map((s) => s.trim()).filter(Boolean) : [],
  );

  const now = new Date().toISOString();
  let count = 0;
  for (const entry of mirror) {
    if (!entry.isReminder || entry.undone || entry.completedByUser) continue;
    if (!incompleteIds.has(entry.externalId)) {
      entry.completedByUser = now;
      count++;
    }
  }

  if (count > 0) writeCalendarMirror(mirror);
  return count;
}
