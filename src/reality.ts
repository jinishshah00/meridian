import { randomUUID } from "crypto";
import type { ActivityEntry, ActivityType, CurrentState, StalenessLevel, Task } from "./types.js";
import {
  appendActivityEntry,
  readActivityLog as _readActivityLog,
  readCurrentState,
  writeCurrentState,
} from "./storage.js";

// ─── Staleness thresholds ──────────────────────────────────────────────────────

const FRESH_THRESHOLD_MS = 12 * 60 * 60 * 1000;  // 12 hours
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;  // 24 hours

// ─── classifyActivityType ──────────────────────────────────────────────────────

/**
 * Derive an ActivityType from the raw message text using simple heuristics.
 *
 * The ordering matters: we check more-specific patterns first so that
 * "finished heading to office" resolves to 'completed', not 'status'.
 */
export function classifyActivityType(text: string): ActivityType {
  const lower = text.toLowerCase().trim();

  // 'completed' — past-tense action verbs or explicit completion phrases
  if (
    /\b(finished|called|completed|done|did|sent|submitted|delivered|resolved|closed|wrapped|ended|stopped|ate|had|went|visited|met|spoke|talked)\b/.test(lower)
  ) {
    return "completed";
  }

  // 'started' — beginning phrases
  if (/\b(starting|beginning|kicked off|just started|beginning|starting up|begun)\b/.test(lower)) {
    return "started";
  }

  // 'status' — location or current presence phrases
  if (/\b(at |in |heading to |on my way|arrived|leaving|left|heading home|heading back)\b/.test(lower)) {
    return "status";
  }

  return "note";
}

// ─── Time parsing ─────────────────────────────────────────────────────────────

/**
 * Parse an explicit or relative time reference from the message text.
 * Returns a Date set to today's date (relative to `now`) with the parsed time.
 *
 * Supported forms:
 *   - "at 7", "at 9:30am", "at 14:00", "at 7pm" → today at that clock time
 *   - "this morning" / "morning" → today at 08:00
 *   - "this afternoon" / "afternoon" → today at 14:00
 *   - "this evening" / "evening" / "tonight" → today at 19:00
 *   - everything else → `now` unchanged
 */
export function parseMessageTime(text: string, now: Date = new Date()): Date {
  const lower = text.toLowerCase();

  // Explicit time: "at HH:MM", "at H:MMam/pm", "at Ham/pm", "at H"
  // Group 1: hours, Group 2: optional minutes, Group 3: optional am/pm
  const explicitMatch = lower.match(
    /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/
  );

  if (explicitMatch != null) {
    const rawHour = parseInt(explicitMatch[1] ?? "0", 10);
    const rawMinutes = parseInt(explicitMatch[2] ?? "0", 10);
    const meridiem = explicitMatch[3];

    let hour = rawHour;

    if (meridiem === "pm" && rawHour < 12) {
      hour = rawHour + 12;
    } else if (meridiem === "am" && rawHour === 12) {
      hour = 0;
    }
    // 24-hour format ("at 14:00") — no meridiem, already correct

    const result = new Date(now);
    result.setHours(hour, rawMinutes, 0, 0);
    return result;
  }

  // Relative period hints — use the midpoint of the period
  if (/\b(this\s+)?morning\b/.test(lower)) {
    const result = new Date(now);
    result.setHours(8, 0, 0, 0);
    return result;
  }

  if (/\b(this\s+)?afternoon\b/.test(lower)) {
    const result = new Date(now);
    result.setHours(14, 0, 0, 0);
    return result;
  }

  if (/\b(this\s+)?(evening|tonight)\b/.test(lower)) {
    const result = new Date(now);
    result.setHours(19, 0, 0, 0);
    return result;
  }

  return now;
}

// ─── Intent closing ───────────────────────────────────────────────────────────

/**
 * Extract the object noun after a past-tense verb in the message.
 * Returns an array of candidate words from the direct object phrase.
 *
 * e.g. "finished the report" → ["the", "report"]
 *      "called John" → ["john"]
 *      "sent the email to boss" → ["the", "email", "to", "boss"]
 */
function extractObjectWords(text: string): string[] {
  const lower = text.toLowerCase();

  const verbMatch = lower.match(
    /\b(?:finished|called|completed|did|sent|submitted|delivered|resolved|closed|wrapped|ended|stopped)\s+(.+)/
  );

  if (verbMatch == null) return [];

  // Strip filler words so we match on the content words
  const phrase = verbMatch[1] ?? "";
  return phrase
    .split(/\s+/)
    .filter((w) => w.length > 2 && !["the", "and", "for", "with", "that", "this", "to", "a", "an"].includes(w));
}

/**
 * Stem a word minimally: strip common English suffixes so "reports" matches
 * "report", "running" matches "run", etc.
 * This is intentionally simple — no external library needed.
 */
function stem(word: string): string {
  return word
    .replace(/ing$/, "")
    .replace(/tion$/, "t")
    .replace(/ed$/, "")
    .replace(/s$/, "")
    .replace(/es$/, "");
}

/**
 * Find the single open task that keyword-matches the message.
 * Returns the task id when exactly one match is found, undefined otherwise.
 */
function findMatchingTaskId(rawText: string, tasks: Task[]): string | undefined {
  const openTasks = tasks.filter(
    (t) => t.status === "todo" || t.status === "scheduled"
  );

  if (openTasks.length === 0) return undefined;

  const objectWords = extractObjectWords(rawText);
  if (objectWords.length === 0) return undefined;

  const stemmedObject = objectWords.map(stem);

  const matches = openTasks.filter((task) => {
    const titleWords = task.title.toLowerCase().split(/\s+/).map(stem);
    // Match if any stemmed object word appears in the task title (substring or exact)
    return stemmedObject.some((ow) =>
      titleWords.some((tw) => tw.includes(ow) || ow.includes(tw))
    );
  });

  // Only close when exactly one task matches to avoid ambiguous closes
  return matches.length === 1 ? matches[0]?.id : undefined;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Ingest a raw message into the reality layer.
 *
 * Parses the timestamp (user-supplied time wins over system clock), classifies
 * the activity type, attempts to close a matching open task, appends the entry
 * to the activity log, and updates CurrentState.
 *
 * Returns the created ActivityEntry and the id of any closed task.
 */
export async function ingestReality(
  rawText: string,
  tasks: Task[]
): Promise<{ entry: ActivityEntry; closedTaskId?: string }> {
  const now = new Date();
  const timestamp = parseMessageTime(rawText, now);
  const type = classifyActivityType(rawText);
  const closedTaskId = findMatchingTaskId(rawText, tasks);

  const entry: ActivityEntry = {
    id: randomUUID(),
    timestamp: timestamp.toISOString(),
    type,
    rawText,
    parsedFields: {},
    ...(closedTaskId !== undefined ? { closedTaskId } : {}),
  };

  appendActivityEntry(entry);

  // Update CurrentState — staleness will be computed fresh on next read
  const nextState: CurrentState = {
    lastObservation: rawText,
    lastObservedAt: timestamp.toISOString(),
    staleness: computeStaleness(timestamp, now),
  };
  writeCurrentState(nextState);

  return { entry, ...(closedTaskId !== undefined ? { closedTaskId } : {}) };
}

// ─── Staleness helpers ────────────────────────────────────────────────────────

function computeStaleness(lastObservedAt: Date, now: Date): StalenessLevel {
  const ageMs = now.getTime() - lastObservedAt.getTime();
  if (ageMs < FRESH_THRESHOLD_MS) return "fresh";
  if (ageMs < STALE_THRESHOLD_MS) return "stale";
  return "unknown";
}

/**
 * Read current state, computing staleness at read time rather than trusting
 * the staleness field persisted on disk.
 *
 * This ensures the caller always receives an accurate staleness value even if
 * the state was written long ago and no new observation has arrived.
 */
export function getCurrentState(): CurrentState {
  const stored = readCurrentState();
  const lastObservedAt = new Date(stored.lastObservedAt);
  const now = new Date();

  // new Date(0) is the epoch default written by storage.ts when no state exists
  const staleness =
    isNaN(lastObservedAt.getTime()) || lastObservedAt.getTime() === 0
      ? "unknown"
      : computeStaleness(lastObservedAt, now);

  return { ...stored, staleness };
}
