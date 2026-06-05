import { findNextSlot } from "./config.js";
import { getUpcomingEvents } from "./plan.js";
import { getCurrentState } from "./reality.js";
import { readPolicy, readTasks } from "./storage.js";
import type { CurrentState, PolicyConfig, Task } from "./types.js";

// ─── Types ────────────────────────────────────────────────────────────────────

type TimeSlot = { startAt: Date; endAt: Date };

// ─── isBlockedByCurrentState ──────────────────────────────────────────────────

/**
 * Check if auto-scheduling a task would conflict with current state.
 *
 * Blocks only when ALL three conditions hold:
 *   1. State is fresh (stale/unknown state cannot be trusted to block anything)
 *   2. The proposed slot starts within the next 2 hours
 *   3. The task is tagged #personal or #errand AND current activity is work/office
 *
 * Intentionally narrow — avoids over-blocking on ambiguous signals.
 */
export function isBlockedByCurrentState(
  task: Task,
  proposedSlot: TimeSlot,
  currentState: CurrentState,
  config: PolicyConfig,
  now: Date = new Date()
): boolean {
  // Condition 1: stale or unknown state doesn't block anything
  if (currentState.staleness !== "fresh") return false;

  // Condition 2: slot must start strictly within the next 2 hours from now.
  // "Within 2 hours" means the gap is < 2h; exactly 2h at the boundary is not blocked.
  const twoHoursMs = 2 * 60 * 60 * 1000;
  if (proposedSlot.startAt.getTime() - now.getTime() >= twoHoursMs) return false;

  // Condition 3a: task must carry a personal/errand tag
  const hasPersonalTag = task.tags.some(
    (tag) => tag === "personal" || tag === "errand"
  );
  if (!hasPersonalTag) return false;

  // Condition 3b: current activity must reference office or work
  const activity = (currentState.activity ?? "").toLowerCase();
  const isWorkContext = activity.includes("office") || activity.includes("work");
  if (!isWorkContext) return false;

  // config is accepted as a parameter for future policy expansion, not used now
  void config;

  return true;
}

// ─── proposeSlot ──────────────────────────────────────────────────────────────

/**
 * Attempt to auto-schedule a single task (Tier 2).
 * Returns the proposed slot, or null if no valid slot found within 7 days.
 * Does NOT write to disk or calendar — caller executes.
 *
 * Retry logic: if the first candidate is blocked by current state, advance
 * `after` by 1 hour and try once more. A second block → return null.
 */
export async function proposeSlot(
  task: Task,
  config: PolicyConfig,
  existingEvents: Array<TimeSlot>,
  currentState: CurrentState,
  now: Date = new Date()
): Promise<TimeSlot | null> {
  const durationMinutes = task.estimatedMinutes ?? 30;

  const attempt = (after: Date): TimeSlot | null => {
    const slotStart = findNextSlot(after, durationMinutes, config, existingEvents);
    if (slotStart === null) return null;
    const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60 * 1000);
    return { startAt: slotStart, endAt: slotEnd };
  };

  const first = attempt(now);
  if (first === null) return null;

  if (!isBlockedByCurrentState(task, first, currentState, config, now)) {
    return first;
  }

  // Blocked — advance by 1 hour and retry once
  const retryAfter = new Date(now.getTime() + 60 * 60 * 1000);
  const second = attempt(retryAfter);
  if (second === null) return null;

  if (!isBlockedByCurrentState(task, second, currentState, config, now)) {
    return second;
  }

  return null;
}

// ─── runDailySchedulingPass ───────────────────────────────────────────────────

/**
 * Run the daily Tier 2 scheduling pass:
 * - Finds all tasks with status 'todo' and a recurrenceRule
 * - Proposes a slot for each (up to dailyCap total)
 * - Returns proposed placements for the caller to confirm + execute
 *
 * Does NOT write to disk or calendar.
 *
 * `_getUpcomingEvents` is injectable so tests can avoid the osascript boundary.
 * Production callers omit the argument and get the real Apple Calendar reader.
 */
export async function runDailySchedulingPass(
  now: Date = new Date(),
  _getUpcomingEvents: (days: number) => Promise<Array<{ startAt: string; endAt?: string; isReminder: boolean }>> = getUpcomingEvents
): Promise<Array<{ task: Task; proposedSlot: TimeSlot }>> {
  const tasks = readTasks();
  const config = readPolicy();
  const currentState = getCurrentState();

  // Convert CalendarMirrorEntry-shaped entries to plain TimeSlot[] for slot-finding
  const upcomingMirrorEntries = await _getUpcomingEvents(7);
  const existingEvents: TimeSlot[] = upcomingMirrorEntries
    .filter((e) => !e.isReminder && e.endAt !== undefined)
    .map((e) => ({
      startAt: new Date(e.startAt),
      endAt: new Date(e.endAt as string),
    }));

  const eligible = tasks.filter(
    (t) => t.status === "todo" && t.recurrenceRule !== undefined
  );

  const placements: Array<{ task: Task; proposedSlot: TimeSlot }> = [];

  for (const task of eligible) {
    if (placements.length >= config.dailyCap) break;

    const slot = await proposeSlot(task, config, existingEvents, currentState, now);
    if (slot !== null) {
      placements.push({ task, proposedSlot: slot });
    }
  }

  return placements;
}

// ─── resolveConflict ──────────────────────────────────────────────────────────

/**
 * Resolve a conflict: an auto-scheduled slot now overlaps a new manual event.
 * Returns a new proposed slot (moved forward past the conflict), or null if no
 * slot is found within 7 days.
 */
export async function resolveConflict(
  task: Task,
  conflictingEvent: TimeSlot,
  config: PolicyConfig,
  existingEvents: Array<TimeSlot>,
  now: Date = new Date()
): Promise<TimeSlot | null> {
  const after = conflictingEvent.endAt;
  const durationMinutes = task.estimatedMinutes ?? 30;

  // Merge the conflicting event into existingEvents, deduplicating by reference
  // equality on the same startAt+endAt millisecond values.
  const alreadyPresent = existingEvents.some(
    (e) =>
      e.startAt.getTime() === conflictingEvent.startAt.getTime() &&
      e.endAt.getTime() === conflictingEvent.endAt.getTime()
  );
  const mergedEvents = alreadyPresent
    ? existingEvents
    : [...existingEvents, conflictingEvent];

  void now; // now is accepted for API symmetry but findNextSlot uses `after`

  const slotStart = findNextSlot(after, durationMinutes, config, mergedEvents);
  if (slotStart === null) return null;

  const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60 * 1000);
  return { startAt: slotStart, endAt: slotEnd };
}
