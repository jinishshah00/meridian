import { getCurrentState } from "../reality.js";

const state = getCurrentState();

if (!state.lastObservation || state.staleness === "unknown") {
  process.stdout.write("unknown\n");
} else {
  const time = new Date(state.lastObservedAt).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  process.stdout.write(`${state.lastObservation} (as of ${time}, ${state.staleness})\n`);
}
