import { syncReminderCompletions } from "../plan.js";
import { readCalendarMirror } from "../storage.js";

try {
  const synced = await syncReminderCompletions();
  if (synced > 0) {
    process.stderr.write(`synced: ${synced} reminder(s) marked completed by user\n`);
  }
} catch (err) {
  process.stderr.write(
    `warning: could not sync from Reminders app: ${err instanceof Error ? err.message : String(err)}\n`,
  );
}

const mirror = readCalendarMirror();
const active = mirror.filter((e) => e.isReminder && !e.undone && !e.completedByUser);

if (active.length === 0) {
  process.stdout.write("no active reminders\n");
} else {
  for (const entry of active) {
    const d = new Date(entry.startAt);
    // Format in system local time — no UTC, no hardcoded timezone
    const dateStr = d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const timeStr = d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
    process.stdout.write(`• ${entry.title} — ${dateStr} at ${timeStr}\n`);
  }
}
