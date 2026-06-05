import { dropTask, updateTaskStatus } from "./intent.js";
import { createCalendarEvent, createReminder, undoCalendarEntry } from "./plan.js";
import { ingestReality } from "./reality.js";
import type { RouteResult } from "./router.js";
import { readCalendarMirror, readTasks, writeTasks } from "./storage.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export type ExecutionResult = {
  action: string; // human-readable summary of what happened
  data?: unknown; // structured result (task created, entry logged, etc.)
  warning?: string; // e.g. "similar task already exists: ..."
};

// ─── execute ──────────────────────────────────────────────────────────────────

/**
 * Dispatch a RouteResult to the real layers.
 *
 * When dryRun is true, all writes and osascript calls are skipped and the
 * returned action describes what would have happened.
 *
 * Keeping execution separate from routing (router.ts is pure) makes both
 * layers independently testable.
 */
export async function execute(
  result: RouteResult,
  rawText: string,
  opts?: { dryRun?: boolean }
): Promise<ExecutionResult> {
  const dryRun = opts?.dryRun === true;
  const { action } = result;

  switch (action.type) {
    // ── answer: no mutations, just return the response ─────────────────────────
    case "answer": {
      return {
        action: "answered",
        data: action.response,
      };
    }

    // ── clarify: no mutations, surface the clarifying question ─────────────────
    case "clarify": {
      return {
        action: "clarify",
        data: action.question,
      };
    }

    // ── createTask: persist the task the router already built ──────────────────
    case "createTask": {
      const task = action.task;
      const execResult: ExecutionResult = {
        action: `Task created: "${task.title}"`,
        data: task,
      };

      if (result.duplicates !== undefined && result.duplicates.length > 0) {
        const titles = result.duplicates.map((d) => `"${d.title}"`).join(", ");
        execResult.warning = `Similar task${result.duplicates.length > 1 ? "s" : ""} already exist${result.duplicates.length === 1 ? "s" : ""}: ${titles}`;
      }

      if (!dryRun) {
        const tasks = readTasks();
        writeTasks([...tasks, task]);
      }

      return execResult;
    }

    // ── logReality: ingestReality handles its own writes ───────────────────────
    case "logReality": {
      let closedTaskId: string | undefined;

      if (!dryRun) {
        const tasks = readTasks();
        const ingestResult = await ingestReality(rawText, tasks);
        closedTaskId = ingestResult.closedTaskId;

        // Transition the matched task to 'done' and persist it.
        // ingestReality only writes activity-log.json and current-state.json —
        // the task array itself must be updated here.
        if (closedTaskId !== undefined) {
          try {
            const updatedTasks = updateTaskStatus(closedTaskId, "done", tasks);
            writeTasks(updatedTasks);
          } catch {
            // Task may have already been closed (terminal status); not fatal.
          }
        }
      } else {
        closedTaskId = action.closedTaskId;
      }

      const base = `Activity logged (${action.entry.type})`;
      const suffix = closedTaskId !== undefined ? ` — closed task ${closedTaskId}` : "";

      return {
        action: `${base}${suffix}`,
        data: { entry: action.entry, closedTaskId },
      };
    }

    // ── createEvent: call plan layer, skip osascript in dryRun ────────────────
    case "createEvent": {
      const { title, startAt, endAt, tier } = action;

      if (dryRun) {
        return {
          action: `[dry-run] Event scheduled: "${title}" — ${formatDate(startAt)} to ${formatDate(endAt)} (Tier ${tier} — awaiting confirmation)`,
          data: { title, startAt: startAt.toISOString(), endAt: endAt.toISOString(), tier },
        };
      }

      const entry = await createCalendarEvent({ title, startAt, endAt, tier });
      return {
        action: `Event scheduled: "${title}" — ${formatDate(startAt)} to ${formatDate(endAt)} (Tier ${tier} — awaiting confirmation)`,
        data: entry,
      };
    }

    // ── createReminder: call plan layer, skip osascript in dryRun ─────────────
    case "createReminder": {
      const { title, dueAt, tier } = action;

      if (dryRun) {
        return {
          action: `[dry-run] Reminder created: "${title}" — ${formatDate(dueAt)} (Tier ${tier})`,
          data: { title, dueAt: dueAt.toISOString(), tier },
        };
      }

      const entry = await createReminder({ title, dueAt, tier });
      return {
        action: `Reminder created: "${title}" — ${formatDate(dueAt)} (Tier ${tier})`,
        data: entry,
      };
    }

    // ── command: mutation commands against tasks and calendar mirror ───────────
    case "command": {
      const { subtype, targetTitle } = action;

      if (subtype === "drop") {
        const tasks = readTasks();
        const target = tasks.find(
          (t) =>
            t.title.toLowerCase().includes(targetTitle.toLowerCase()) &&
            t.status !== "done" &&
            t.status !== "dropped"
        );

        if (target === undefined) {
          return {
            action: `No active task matching "${targetTitle}" found`,
            data: { targetTitle },
          };
        }

        if (!dryRun) {
          const updated = dropTask(target.id, tasks);
          writeTasks(updated);
        }

        return {
          action: `Task dropped: "${target.title}"`,
          data: { droppedTask: target },
        };
      }

      // cancel / reschedule / move — find event in mirror, undo + optionally re-create
      if (subtype === "cancel" || subtype === "reschedule" || subtype === "move") {
        const mirror = readCalendarMirror();
        const entry = mirror.find(
          (e) =>
            !e.undone &&
            e.title.toLowerCase().includes(targetTitle.toLowerCase())
        );

        if (entry === undefined) {
          return {
            action: `No active calendar entry matching "${targetTitle}" found`,
            data: { targetTitle },
          };
        }

        if (subtype === "cancel") {
          if (!dryRun) {
            await undoCalendarEntry(entry.id);
          }
          return {
            action: `Calendar entry cancelled: "${entry.title}"`,
            data: { cancelledEntry: entry },
          };
        }

        // reschedule / move — undo then re-create at new time if provided
        const newTime = action.newTime;

        if (!dryRun) {
          await undoCalendarEntry(entry.id);
        }

        if (newTime === undefined) {
          return {
            action: `Calendar entry removed: "${entry.title}" — no new time provided`,
            data: { removedEntry: entry },
          };
        }

        const newEndAt = new Date(newTime.getTime() + 60 * 60 * 1000);

        if (dryRun) {
          return {
            action: `[dry-run] Calendar entry rescheduled: "${entry.title}" → ${formatDate(newTime)}`,
            data: { entry, newTime: newTime.toISOString() },
          };
        }

        const newEntry = await createCalendarEvent({
          title: entry.title,
          startAt: newTime,
          endAt: newEndAt,
          tier: entry.tier as 1 | 2,
        });

        return {
          action: `Calendar entry rescheduled: "${entry.title}" → ${formatDate(newTime)}`,
          data: { oldEntry: entry, newEntry },
        };
      }

      // Exhaustive guard — subtype is a discriminated union so this is unreachable
      return {
        action: `Unknown command subtype`,
        data: { subtype },
      };
    }
  }
}

// ─── Formatting helper ────────────────────────────────────────────────────────

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * Format a Date as a short human-readable string: "Thu Jun 5 at 3:00pm"
 */
function formatDate(d: Date): string {
  const weekday = WEEKDAYS[d.getDay()];
  const month = MONTHS[d.getMonth()];
  const day = d.getDate();
  const rawHours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, "0");
  const ampm = rawHours < 12 ? "am" : "pm";
  const hours = rawHours === 0 ? 12 : rawHours > 12 ? rawHours - 12 : rawHours;
  return `${weekday} ${month} ${day} at ${hours}:${minutes}${ampm}`;
}
