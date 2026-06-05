# Setup

## macOS permissions required

The Plan layer uses `osascript` to drive Calendar.app and Reminders.app. macOS requires explicit Automation permission for the process that calls `osascript`.

### Steps

1. Open **System Settings → Privacy & Security → Automation**.
2. Find the terminal emulator or shell host you run the agent from (e.g. Terminal, iTerm2, or the parent app if running as a service).
3. Enable the toggle for **Calendar** and **Reminders** under that app.

If the permission dialog never appeared, trigger it by running:

```bash
osascript -e 'tell application "Calendar" to return name of first calendar'
```

macOS will prompt for access on first run.

### Verifying access

```bash
# Should return the name of your first calendar (e.g. "Home")
osascript -e 'tell application "Calendar" to return name of first calendar'

# Should return the name of your first Reminders list (e.g. "Reminders")
osascript -e 'tell application "Reminders" to return name of first list'
```

If either command returns an error like `"Calendar" got an error: Not authorized`, re-check the Automation settings above.

## Running integration tests

Integration tests create and delete real Calendar events and Reminders. Before running them:

1. Create a calendar named `personal-assistant-test` in Calendar.app.
2. Create a reminders list named `personal-assistant-test` in Reminders.app.

Then run:

```bash
RUN_INTEGRATION=1 bun test tests/plan.integration.test.ts
```

Unit tests (no osascript, no Calendar access required) run as part of the normal test suite:

```bash
bun test
```
