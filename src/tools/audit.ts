import { getAuditTrail, formatEntry } from "../audit.js";

const trail = getAuditTrail();

if (trail.length === 0) {
  process.stdout.write("no entries\n");
} else {
  for (const entry of trail) {
    process.stdout.write(formatEntry(entry) + "\n");
  }
}
