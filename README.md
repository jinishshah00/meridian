<img src="https://capsule-render.vercel.app/api?type=soft&color=gradient&customColorList=11,20,24&height=180&section=header&text=meridian&fontSize=80&fontColor=ffffff&animation=fadeIn&fontAlignY=55&desc=your%20brain%2C%20backed%20up&descAlignY=78&descSize=20" width="100%"/>

<div align="center">

<img src="https://readme-typing-svg.demolab.com/?font=Fira+Code&weight=500&size=18&duration=2800&pause=1000&color=7DD3FC&center=true&vCenter=true&width=580&height=42&lines=%22remind+me+to+call+dentist+at+3pm%22;%22just+finished+the+Q3+roadmap%22;%22what%27s+on+my+list+today%3F%22;%22I+need+to+learn+Rust%22;%22block+2+hours+Friday+for+deep+work%22" alt="Typing SVG" />

</div>

---

You finally sit down to work. Brain fog hits. _What was I supposed to do? Did I finish that thing? What did I say I'd handle this week?_

Meridian is a Claude Code-powered personal assistant that lives in your terminal. Talk to it like a chief of staff. It routes your words into the right layer, writes to Apple Calendar and Reminders, and keeps a log of what you actually did — all in plain files on your Mac.

No app. No subscription. No dashboard.

---

## Three layers

<table>
<tr>
<td align="center" width="33%">

**INTENT**

Things you want to do,<br/>no time attached yet.

`data/tasks.json`

</td>
<td align="center" width="33%">

**PLAN**

Time-boxed commitments<br/>written to Apple Calendar<br/>and Reminders.

`data/calendar-mirror.json`

</td>
<td align="center" width="33%">

**REALITY**

Append-only log of<br/>what you actually did.

`data/activity-log.json`

</td>
</tr>
</table>

---

## Setup

### 1 — Install prerequisites

**Claude Code** (the AI brain):
```bash
npm install -g @anthropic/claude-code
claude auth login
```

**Bun** (the runtime):
```bash
curl -fsSL https://bun.sh/install | bash
```

### 2 — Clone and install

```bash
git clone https://github.com/jinishshah00/meridian
cd meridian
bun install
```

### 3 — Grant macOS permissions

Meridian writes to Apple Calendar and Reminders via `osascript`. macOS will prompt for access the first time — trigger it manually:

```bash
osascript -e 'tell application "Calendar" to return name of first calendar'
osascript -e 'tell application "Reminders" to return name of first list'
```

If it doesn't prompt: **System Settings → Privacy & Security → Automation** → find Terminal → enable Calendar and Reminders.

### 4 — Start talking on Mac

```bash
cd meridian
claude
```

Just talk:

> "remind me to call dentist at 3pm"  
> "just finished the Q3 roadmap"  
> "what's on my list today?"

Your `data/` folder is created automatically on first use. Everything stays local.

### 5 — Use from iPhone (optional)

Run Meridian remotely from the Claude mobile app on your iPhone. Inside the Claude Code session, run:

```
/remote-control
```

This gives you a link you open in the Claude iOS app. From that point you can talk to Meridian by voice or text from your phone — same assistant, same local data on your Mac, no extra infrastructure.

---

## What you say → what happens

| You say | Goes to | Result |
|---|---|---|
| `"I'm at the gym"` | Reality | Timestamped entry in activity log |
| `"learn Rust"` | Intent | Task added to backlog |
| `"call Sarah at 2pm tomorrow"` | Plan | Proposes calendar event — you confirm |
| `"remind me to pay rent on the 1st"` | Plan | Sets Apple Reminder |
| `"what am I up to?"` | — | Last known activity + staleness |
| `"drop the dentist task"` | Intent | Removed from backlog |

Meridian reads tense and time presence to decide the layer. Ambiguous input gets one clarifying question, never a silent guess.

---

## Autonomy tiers

Meridian never acts silently. Every creation is gated:

| Tier | Behaviour | Used for |
|---|---|---|
| **0** | Log only | Reality pings, freeform notes |
| **1** | Propose → you confirm | All new events and reminders (default) |
| **2** | Auto-schedule + notify | Explicit declared recurrences only |
| **3** | Never auto | Irreversible, people-affecting, money |

---

## Requirements

| | |
|---|---|
| Mac | Apple Silicon or Intel, macOS 13+ |
| [Claude Code](https://github.com/anthropics/claude-code) | `npm install -g @anthropic/claude-code` |
| [Bun](https://bun.sh) | `curl -fsSL https://bun.sh/install \| bash` |
| macOS Automation | Calendar + Reminders access for Terminal |

---

## Built with

<div align="center">

[![Skills](https://skillicons.dev/icons?i=ts,bun,apple&perline=3)](https://skillicons.dev)

</div>

---

## Data + privacy

Everything stays on your Mac. The `data/` directory is gitignored. Plain JSON, human-readable, portable. Apple Calendar and Reminders are the source of truth for the Plan layer — Meridian only mirrors writes locally for audit and undo.

No auth. No API keys. No cloud.

---

<div align="center">

*built for the lazy — and the ones who forget everything the moment they finally have time*

</div>

<img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=11,20,24&height=120&section=footer" width="100%"/>
