import { randomUUID } from "crypto";
import { createTask as _createTask, findDuplicates } from "./intent.js";
import type { ActivityEntry, ActivityType, Task } from "./types.js";

// ─── Public types ──────────────────────────────────────────────────────────────

export type RouteAction =
  | { type: "answer"; response: string }
  | { type: "createEvent"; title: string; startAt: Date; endAt: Date; tier: 1 | 2 }
  | { type: "createReminder"; title: string; dueAt: Date; tier: 1 | 2 }
  | { type: "createTask"; task: Task }
  | { type: "logReality"; entry: ActivityEntry; closedTaskId?: string }
  | {
      type: "command";
      subtype: "reschedule" | "cancel" | "drop" | "move";
      targetTitle: string;
      newTime?: Date;
    }
  | { type: "clarify"; question: string };

export type RouteResult = {
  action: RouteAction;
  confidence: "high" | "low";
  // Populated when action.type === 'createTask' and near-duplicates are found.
  duplicates?: Task[];
};

// ─── Question detection ────────────────────────────────────────────────────────

const QUESTION_STARTERS =
  /^(what|when|how|why|where|who|is|are|do|does|can|could|should|would|will)\b/i;

/**
 * A message is a question when it ends with "?" or starts with an interrogative
 * word. Checked before all other signals.
 */
export function isQuestion(text: string): boolean {
  const t = text.trim();
  if (t.endsWith("?")) return true;
  return QUESTION_STARTERS.test(t);
}

// ─── Command detection ─────────────────────────────────────────────────────────

type ParsedCommand = {
  subtype: "reschedule" | "cancel" | "drop" | "move";
  targetTitle: string;
  newTime?: Date;
};

const COMMAND_RESCHEDULE = /\breschedule\b/i;
const COMMAND_CANCEL = /\bcancel\b/i;
const COMMAND_DELETE = /\bdelete\b/i;
const COMMAND_DROP = /\bdrop\b/i;
const COMMAND_MOVE = /\bmove\b.*?\bto\b/i;
const COMMAND_MARK = /\bmark\b.*?\bas\b/i;
const COMMAND_RENAME = /\brename\b/i;

/**
 * Return true when the message contains a mutation command keyword.
 */
export function isCommand(text: string): boolean {
  return (
    COMMAND_RESCHEDULE.test(text) ||
    COMMAND_CANCEL.test(text) ||
    COMMAND_DELETE.test(text) ||
    COMMAND_DROP.test(text) ||
    COMMAND_MOVE.test(text) ||
    COMMAND_MARK.test(text) ||
    COMMAND_RENAME.test(text)
  );
}

/**
 * Parse a command message into its subtype and target title.
 *
 * Target extraction is best-effort: strip the verb word(s) and any trailing
 * time phrase, then use what remains as the target. Callers should treat the
 * title as approximate — a UI confirm step should show it before mutating.
 */
function parseCommand(text: string, now: Date): ParsedCommand {
  let subtype: "reschedule" | "cancel" | "drop" | "move";
  let working = text.trim();

  if (COMMAND_RESCHEDULE.test(working)) {
    subtype = "reschedule";
    working = working.replace(COMMAND_RESCHEDULE, "").trim();
  } else if (COMMAND_MOVE.test(working)) {
    subtype = "move";
    // Strip everything from " to " onwards (that's the new time phrase)
    working = working.replace(/\s+to\s+.*/i, "").replace(/\bmove\b/i, "").trim();
  } else if (COMMAND_CANCEL.test(working) || COMMAND_DELETE.test(working)) {
    subtype = "cancel";
    working = working.replace(/\b(cancel|delete)\b/i, "").trim();
  } else if (COMMAND_DROP.test(working)) {
    subtype = "drop";
    working = working.replace(/\bdrop\b/i, "").trim();
  } else if (COMMAND_MARK.test(working)) {
    subtype = "cancel"; // mark as done/dropped → cancel from backlog perspective
    working = working.replace(/\bmark\b|\bas\b.*$/i, "").trim();
  } else {
    subtype = "cancel";
    working = working.replace(/\brename\b/i, "").trim();
  }

  const newTime = extractTime(text, now) ?? undefined;

  // Strip any time phrase residue from the target title
  const targetTitle = stripTimePhrases(working).replace(/\s+/g, " ").trim();

  return { subtype, targetTitle: targetTitle || text.trim(), newTime };
}

// ─── Time extraction ───────────────────────────────────────────────────────────

const WEEKDAY_MAP: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/**
 * Advance `from` to the next occurrence of `targetDay` (0=Sun…6=Sat).
 * If `from` is already that day, returns the next week's occurrence so "next
 * Monday" from a Monday is always 7 days ahead.
 */
function nextWeekday(from: Date, targetDay: number): Date {
  const result = new Date(from);
  const currentDay = result.getDay();
  let daysAhead = targetDay - currentDay;
  if (daysAhead <= 0) daysAhead += 7;
  result.setDate(result.getDate() + daysAhead);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Parse an explicit clock time phrase ("at 3pm", "at 15:00", "at 9:30am",
 * "at noon", "at midnight") from `text`.
 * Returns `{ hours, minutes }` or null.
 */
function parseClockTime(text: string): { hours: number; minutes: number } | null {
  const lower = text.toLowerCase();

  if (/\bnoon\b/.test(lower)) return { hours: 12, minutes: 0 };
  if (/\bmidnight\b/.test(lower)) return { hours: 0, minutes: 0 };

  // "at H:MM am/pm", "at H am/pm", "at HH:MM" (24-hour)
  const m = lower.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (m == null) return null;

  const rawHour = parseInt(m[1] ?? "0", 10);
  const rawMin = parseInt(m[2] ?? "0", 10);
  const meridiem = m[3];

  let hours = rawHour;
  if (meridiem === "pm" && rawHour < 12) hours = rawHour + 12;
  else if (meridiem === "am" && rawHour === 12) hours = 0;
  // 24-hour format ("at 14:00") — already correct

  return { hours, minutes: rawMin };
}

/**
 * Extract an absolute Date from a natural-language time reference.
 *
 * Handles:
 * - "tomorrow [at ...]"
 * - "next <weekday> [at ...]"
 * - "<weekday> [at ...]" — next occurrence of that weekday
 * - "at <time>" — today at that clock time
 *
 * Returns null when no recognisable time reference is present.
 */
export function extractTime(text: string, now: Date = new Date()): Date | null {
  const lower = text.toLowerCase();
  const clock = parseClockTime(lower);

  // "tomorrow"
  if (/\btomorrow\b/.test(lower)) {
    const result = new Date(now);
    result.setDate(result.getDate() + 1);
    if (clock !== null) {
      result.setHours(clock.hours, clock.minutes, 0, 0);
    } else {
      result.setHours(0, 0, 0, 0);
    }
    return result;
  }

  // "next <weekday>"
  const nextMatch = lower.match(/\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (nextMatch != null) {
    const targetDay = WEEKDAY_MAP[nextMatch[1] as string] as number;
    const result = nextWeekday(now, targetDay);
    if (clock !== null) {
      result.setHours(clock.hours, clock.minutes, 0, 0);
    }
    return result;
  }

  // Bare "<weekday>" — next occurrence (same logic as "next <weekday>" but may
  // include today if we are on that day it still advances by 7 days, matching
  // the intent of "Thursday 3pm" when said on any day)
  const weekdayMatch = lower.match(
    /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/
  );
  if (weekdayMatch != null) {
    const targetDay = WEEKDAY_MAP[weekdayMatch[1] as string] as number;
    const result = nextWeekday(now, targetDay);
    if (clock !== null) {
      result.setHours(clock.hours, clock.minutes, 0, 0);
    }
    return result;
  }

  // Bare "at <time>" with no day reference → today
  if (clock !== null) {
    const result = new Date(now);
    result.setHours(clock.hours, clock.minutes, 0, 0);
    return result;
  }

  return null;
}

// ─── Strip time phrases (for title cleaning) ───────────────────────────────────

function stripTimePhrases(text: string): string {
  return text
    .replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, "")
    .replace(/\b(tomorrow|next\s+\w+)\b/gi, "")
    .replace(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi, "")
    .replace(/\bnoon\b|\bmidnight\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Tense detection ───────────────────────────────────────────────────────────

const PAST_TENSE_VERBS =
  /\b(called|finished|went|did|sent|bought|ate|ran|worked|met|spoke|talked|completed|submitted|delivered|resolved|closed|wrapped|ended|stopped|had|visited|arrived)\b/i;

// "at \w+" only matches location phrases, not clock times ("at 3pm", "at 9:30am").
// The negative lookahead prevents "at 8pm" or "at 15:00" from being treated as a
// presence signal, which would falsely raise the ambiguity score.
const PRESENT_STATUS_PHRASES =
  /\b(at\s+(?!\d)\w+|in\s+(?!\d)\w+|heading\s+to|working\s+on|on\s+a\s+call|commuting|heading\s+home|heading\s+back|on\s+my\s+way)\b/i;

const FUTURE_INDICATORS =
  /\b(need\s+to|want\s+to|going\s+to|will|plan\s+to|remind\s+me|have\s+to|gotta|gonna|should|must)\b/i;

/**
 * Signal counts used to score tense ambiguity.
 */
type TenseSignals = {
  pastScore: number;
  futureScore: number;
  presentScore: number;
};

function scoreTense(text: string): TenseSignals {
  const lower = text.toLowerCase();
  let pastScore = 0;
  let futureScore = 0;
  let presentScore = 0;

  // Count individual past-tense verb matches (multiple past verbs = stronger signal)
  const pastMatches = lower.match(
    /\b(called|finished|went|did|sent|bought|ate|ran|worked|met|spoke|talked|completed|submitted|delivered|resolved|closed|wrapped|ended|stopped|had|visited|arrived)\b/g
  );
  pastScore = pastMatches?.length ?? 0;

  // Future modal/intent phrases
  const futureMatches = lower.match(
    /\b(need\s+to|want\s+to|going\s+to|will|plan\s+to|remind\s+me|have\s+to|gotta|gonna|should|must)\b/g
  );
  futureScore = futureMatches?.length ?? 0;

  // Present status phrases
  const presentMatches = lower.match(
    /\b(at\s+(?!\d)\w+|in\s+(?!\d)\w+|heading\s+to|working\s+on|on\s+a\s+call|commuting|heading\s+home|heading\s+back|on\s+my\s+way)\b/g
  );
  presentScore = presentMatches?.length ?? 0;

  return { pastScore, futureScore, presentScore };
}

/**
 * Confidence is LOW (ambiguous) when the strongest tense signal has ≤ 55% of
 * the total signal weight and a competing signal exists.
 */
function computeConfidence(signals: TenseSignals): { confidence: "high" | "low"; ambiguous: boolean } {
  const total = signals.pastScore + signals.futureScore + signals.presentScore;

  if (total === 0) {
    // No tense signal at all — caller must decide by other means (questions, commands, time presence)
    return { confidence: "high", ambiguous: false };
  }

  const maxScore = Math.max(signals.pastScore, signals.futureScore, signals.presentScore);
  const ratio = maxScore / total;

  if (ratio <= 0.55) {
    return { confidence: "low", ambiguous: true };
  }

  return { confidence: "high", ambiguous: false };
}

export function isPastTense(text: string): boolean {
  return PAST_TENSE_VERBS.test(text);
}

export function isPresentStatus(text: string): boolean {
  return PRESENT_STATUS_PHRASES.test(text);
}

export function isFutureTense(text: string): boolean {
  return FUTURE_INDICATORS.test(text);
}

// ─── Point-alert detection ─────────────────────────────────────────────────────

const POINT_ALERT_PATTERNS =
  /\b(remind\s+me|reminder|don'?t\s+forget|take\s+(?:\w+\s+)*(medication|pill|meds|medicine)|call\s+\w+)\b/i;

/**
 * A point alert is a future message that should route to Apple Reminders
 * rather than Calendar — a ping at a moment rather than a time block.
 */
export function isPointAlert(text: string): boolean {
  return POINT_ALERT_PATTERNS.test(text);
}

// ─── Title extraction (strip verbs + time for intent title) ───────────────────

/**
 * Strip common future-intent prefixes from a message to get a clean task title.
 * e.g. "need to call dentist tomorrow" → "call dentist"
 */
function extractTitle(text: string): string {
  let working = text.trim();
  // Strip future-intent prefixes
  working = working.replace(
    /^(i\s+)?(need\s+to|want\s+to|have\s+to|plan\s+to|going\s+to|gotta|gonna|should|must|will)\s+/i,
    ""
  );
  // Strip "remind me to" prefix
  working = working.replace(/^remind\s+me\s+(?:to\s+)?/i, "");
  // Strip time phrases
  working = stripTimePhrases(working);
  return working.replace(/\s+/g, " ").trim() || text.trim();
}

// ─── ActivityEntry builder ────────────────────────────────────────────────────

function buildActivityEntry(text: string, type: ActivityType, closedTaskId?: string): ActivityEntry {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    type,
    rawText: text,
    parsedFields: {},
    ...(closedTaskId !== undefined ? { closedTaskId } : {}),
  };
}

// ─── route() ──────────────────────────────────────────────────────────────────

/**
 * Route a raw message to a typed action without executing any side effects.
 *
 * Evaluation order mirrors the decision tree in the issue spec:
 *   1. Question → answer
 *   2. Command → command
 *   3. Ambiguous tense → clarify
 *   4. Future + time + point alert → createReminder
 *   5. Future + time → createEvent
 *   6. Future + no time → createTask
 *   7. Past tense → logReality (completed)
 *   8. Present status → logReality (status)
 *   9. Default fallback → clarify
 *
 * The router does NOT write to disk or call osascript — the caller is
 * responsible for executing the returned action.
 */
export function route(
  rawText: string,
  tasks: Task[],
  now?: Date
): RouteResult {
  const effectiveNow = now ?? new Date();
  const text = rawText.trim();

  // ── 1. Question ─────────────────────────────────────────────────────────────
  if (isQuestion(text)) {
    return {
      action: {
        type: "answer",
        response: `(query: ${text})`,
      },
      confidence: "high",
    };
  }

  // ── 2. Command ───────────────────────────────────────────────────────────────
  if (isCommand(text)) {
    const parsed = parseCommand(text, effectiveNow);
    return {
      action: {
        type: "command",
        subtype: parsed.subtype,
        targetTitle: parsed.targetTitle,
        ...(parsed.newTime !== undefined ? { newTime: parsed.newTime } : {}),
      },
      confidence: "high",
    };
  }

  // ── Tense scoring — used for steps 3–9 ────────────────────────────────────
  const signals = scoreTense(text);
  const { confidence, ambiguous } = computeConfidence(signals);
  const time = extractTime(text, effectiveNow);
  const hasPast = isPastTense(text);
  const hasPresent = isPresentStatus(text);
  const hasFuture = isFutureTense(text);
  const hasTime = time !== null;

  // ── 3. Ambiguous ─────────────────────────────────────────────────────────────
  if (ambiguous) {
    return {
      action: {
        type: "clarify",
        question:
          "I'm not sure if you're telling me about something that happened or something you want to do. Could you clarify?",
      },
      confidence: "low",
    };
  }

  // ── 4 & 5. Future + explicit time ────────────────────────────────────────────
  if ((hasFuture || hasTime) && hasTime && !hasPast) {
    const title = extractTitle(text);
    const tier: 1 | 2 = 1;

    if (isPointAlert(text)) {
      return {
        action: {
          type: "createReminder",
          title,
          dueAt: time,
          tier,
        },
        confidence,
      };
    }

    // Default event duration: 60 minutes
    const endAt = new Date(time.getTime() + 60 * 60 * 1000);
    return {
      action: {
        type: "createEvent",
        title,
        startAt: time,
        endAt,
        tier,
      },
      confidence,
    };
  }

  // ── 6. Future + no time → task backlog ────────────────────────────────────────
  if (hasFuture && !hasTime && !hasPast) {
    const task = _createTask(text);
    // extractTitle strips future-intent prefixes ("need to", "want to", etc.)
    // before matching, so "need to buy groceries" hits the 0.8 trigram threshold
    // against an existing "buy groceries" task.
    const cleanTitle = extractTitle(text);
    const duplicates = findDuplicates(cleanTitle, tasks);
    return {
      action: {
        type: "createTask",
        task,
      },
      confidence,
      ...(duplicates.length > 0 ? { duplicates } : {}),
    };
  }

  // ── 7. Past tense ─────────────────────────────────────────────────────────────
  if (hasPast && !hasFuture) {
    const entry = buildActivityEntry(text, "completed");
    return {
      action: {
        type: "logReality",
        entry,
      },
      confidence,
    };
  }

  // ── 8. Present status ─────────────────────────────────────────────────────────
  if (hasPresent && !hasPast && !hasFuture) {
    const entry = buildActivityEntry(text, "status");
    return {
      action: {
        type: "logReality",
        entry,
      },
      confidence,
    };
  }

  // ── 9. Fallback — genuinely unclear ───────────────────────────────────────────
  return {
    action: {
      type: "clarify",
      question: "I'm not sure how to handle that. Could you give more context — is this something that happened, something you're planning, or a question?",
    },
    confidence: "low",
  };
}
