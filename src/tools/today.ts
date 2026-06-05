import { getTodaysChanges, formatEntry } from "../audit.js";
import { getUpcomingEvents } from "../plan.js";

const todaysChanges = getTodaysChanges();

if (todaysChanges.length === 0) {
  process.stdout.write("no calendar changes today\n");
} else {
  process.stdout.write("today's calendar changes:\n");
  for (const entry of todaysChanges) {
    process.stdout.write(`  ${formatEntry(entry)}\n`);
  }
}

try {
  const upcoming = await getUpcomingEvents(1);
  if (upcoming.length === 0) {
    process.stdout.write("no upcoming events in the next 24 hours\n");
  } else {
    process.stdout.write("upcoming events (next 24h):\n");
    for (const evt of upcoming) {
      const start = new Date(evt.startAt).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      process.stdout.write(`  ${start} — ${evt.title}\n`);
    }
  }
} catch (err) {
  process.stderr.write(`warning: could not fetch upcoming events: ${err instanceof Error ? err.message : String(err)}\n`);
}
