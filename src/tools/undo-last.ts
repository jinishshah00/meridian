import { undoLast } from "../audit.js";
import { formatEntry } from "../audit.js";

try {
  const entry = await undoLast();

  if (entry === null) {
    process.stdout.write("nothing to undo\n");
  } else {
    process.stdout.write(`undone: ${formatEntry(entry)}\n`);
  }
} catch (err) {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
