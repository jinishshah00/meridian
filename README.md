# Meridian

Your Claude-powered chief of staff — text or voice, local files only.

## The problem

You finally sit down to work and hit brain fog: _What was I supposed to do today? Did I finish that thing? What did I say I'd do this week?_ 

Meridian captures everything in the moment — by voice from your iPhone (via Claude mobile) or by typing to Claude Code on your Mac. It keeps it all in plain JSON files. No app. No subscription. No dashboard. Just your calendar, reminders, and task list staying in sync.

## What it does

| Layer | What it captures | Where it lives |
|---|---|---|
| **Intent** | Tasks you want to do but haven't scheduled | `data/tasks.json` |
| **Plan** | Time-boxed appointments and point alerts | Apple Calendar + Apple Reminders |
| **Reality** | Append-only log of what you actually did | `data/activity-log.json` |

Talk to Meridian like a chief of staff:
- **"I'm at the gym"** → logs to reality
- **"Finish the report"** → adds to task backlog
- **"Call Sarah at 2pm tomorrow"** → proposes a calendar event (you confirm)
- **"Remind me to pay rent on the 1st"** → sets a reminder

Meridian parses tense and time, routes your message to the right layer, and handles the details.

## How it works

```
You (text or voice)
    ↓
Claude Code (reads CLAUDE.md, reasons about your message)
    ↓
src/tools/ (thin CLI wrappers: create-task, log-reality, create-event, etc.)
    ↓
data/ (plain JSON files — all local)
Apple Calendar + Reminders (written via osascript)
```

No server. No cloud. No secrets. Everything lives on your Mac in plain text.

## Setup

### Requirements
- Mac (Intel or Apple Silicon)
- [Claude Code](https://github.com/anthropics/claude-code) CLI installed
- [Bun](https://bun.sh) runtime (`~/.bun/bin/bun`)
- macOS automation permissions (2-minute one-time setup)

### Grant Calendar + Reminders permissions

Open Terminal and run:
```bash
osascript -e 'tell application "Calendar" to return name of first calendar'
```

macOS will ask for permission once. Grant it.

Then verify Reminders:
```bash
osascript -e 'tell application "Reminders" to return name of first list'
```

### Install and run

```bash
git clone <repo-url> meridian
cd meridian
bun install
claude
```

In the Claude Code chat, just talk:

> "I'm working on the Q3 roadmap"

> "remind me to check slack at 3pm today"

> "drop the grocery shopping task"

## Input examples and what happens

| You say | Layer | Result |
|---|---|---|
| "I'm at the gym" | Reality | Logs timestamp + message to `data/activity-log.json` |
| "learn Rust" | Intent | Creates task `learn Rust` in `data/tasks.json` |
| "breakfast at 8:30 tomorrow" | Plan | Proposes calendar event, you confirm → writes to Calendar |
| "call dad on the 20th" | Plan | Proposes reminder, you confirm → writes to Reminders |
| "what am I up to?" | — | Reads `current-state.json`, tells you activity + timestamp |
| "drop that task" | Intent | Removes task from `data/tasks.json` |

## Autonomy model

Meridian never silently acts. Every creation goes through tiers:

| Tier | When | Behaviour |
|---|---|---|
| 0 | Reality pings only | No calendar action |
| 1 | One-off events or reminders (default) | Propose → you approve → execute |
| 2 | Explicit recurring tasks | Auto-schedule (Tier 2 only for declared recurrences) |
| 3 | Irreversible or people-affecting | Always ask, never auto |

New appointments and reminders default to Tier 1 (proposal mode). You see what would happen before it hits your calendar.

## Data privacy

- **Everything stays local.** No cloud sync. No analytics. No servers.
- **Plain JSON files.** Gitignored `data/` directory. Human-readable. Portable.
- **Apple Calendar and Reminders are the source of truth** for Plan layer. Meridian mirrors them in `data/calendar-mirror.json` for audit trail only.
- **No authentication beyond local system access.** Meridian uses osascript (already on your Mac) to read/write Calendar and Reminders.

## Troubleshooting

**"Permission denied" when creating calendar events?**
Grant Reminders and Calendar access to Terminal in System Settings → Privacy & Security → Automation.

**"event created" but it didn't show up in Calendar?**
Check `data/calendar-mirror.json` to confirm it was written. If it's there, restart Calendar app and refresh.

**"I want to reset everything"**
Delete `data/` and restart. Your data files are plain JSON—back them up first if you want.

**Which calendar does it write to?**
By default, your primary calendar (usually "Calendar"). Customize in `data/policy.json` with a `defaultCalendar` field.

## Architecture reference

- `src/tools/` — CLI entry points (create-task, log-reality, create-event, etc.)
- `src/lib/` — Core logic (data access, scheduling, Apple integration)
- `CLAUDE.md` — Meridian's decision tree and routing rules (Claude Code reads this)
- `data/` — Local JSON files (tasks, activity log, calendar mirror, policy)

For implementation details, see `CLAUDE.md` (the Claude Code brain).

---

Built for the lazy. For people who write everything down because they forget it the moment they start work.
