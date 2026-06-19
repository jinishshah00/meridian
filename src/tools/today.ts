import { getTodaysChanges } from "../audit.js";
import { getUpcomingEvents, syncReminderCompletions } from "../plan.js";
import { readCalendarMirror } from "../storage.js";

const todaysChanges = getTodaysChanges();

if (todaysChanges.length === 0) {
  process.stdout.write("no calendar changes today\n");
} else {
  process.stdout.write("today's calendar changes:\n");
  for (const entry of todaysChanges) {
    const d = new Date(entry.startAt);
    const timeStr = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const type = entry.isReminder ? "[Reminder]" : "[Event]";
    const status = entry.undone ? "undone" : entry.completedByUser ? "completed by user" : "active";
    process.stdout.write(`  ${type} ${entry.title} — ${timeStr} (${status})\n`);
  }
}

// Sync reminders then show active ones
try {
  await syncReminderCompletions();
  const mirror = readCalendarMirror();
  const activeReminders = mirror.filter((e) => e.isReminder && !e.undone && !e.completedByUser);
  if (activeReminders.length === 0) {
    process.stdout.write("no active reminders\n");
  } else {
    process.stdout.write("active reminders:\n");
    for (const r of activeReminders) {
      const d = new Date(r.startAt);
      const dateStr = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
      const timeStr = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      process.stdout.write(`  • ${r.title} — ${dateStr} at ${timeStr}\n`);
    }
  }
} catch (err) {
  process.stderr.write(`warning: could not sync/list reminders: ${err instanceof Error ? err.message : String(err)}\n`);
}

try {
  const upcoming = await getUpcomingEvents(1);
  if (upcoming.length === 0) {
    process.stdout.write("no upcoming events in the next 24 hours\n");
  } else {
    process.stdout.write("upcoming events (next 24h):\n");
    for (const evt of upcoming) {
      const start = new Date(evt.startAt).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
      process.stdout.write(`  ${start} — ${evt.title}\n`);
    }
  }
} catch (err) {
  process.stderr.write(`warning: could not fetch upcoming events: ${err instanceof Error ? err.message : String(err)}\n`);
}
