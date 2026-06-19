import { syncReminderCompletions } from "../plan.js";

try {
  const count = await syncReminderCompletions();
  if (count === 0) {
    process.stdout.write("reminders in sync — no completions detected\n");
  } else {
    process.stdout.write(
      `synced: ${count} reminder${count === 1 ? "" : "s"} marked completed by user\n`,
    );
  }
} catch (err) {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
