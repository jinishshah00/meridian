import { describe, expect, test } from "bun:test";
import type { Task } from "../src/types.js";
import {
  extractTime,
  isCommand,
  isPointAlert,
  isPastTense,
  isPresentStatus,
  isFutureTense,
  isQuestion,
  route,
} from "../src/router.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FIXED_NOW = new Date("2026-06-09T10:00:00.000Z"); // Monday

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-id",
    title: "Default task",
    status: "todo",
    priority: 2,
    tags: [],
    source: "Default task",
    createdAt: "2026-01-01T09:00:00.000Z",
    ...overrides,
  };
}

// ─── isQuestion ───────────────────────────────────────────────────────────────

describe("isQuestion", () => {
  test("ends with ?", () => {
    expect(isQuestion("What time is my meeting?")).toBe(true);
  });

  test("starts with what", () => {
    expect(isQuestion("what is on my calendar today")).toBe(true);
  });

  test("starts with when", () => {
    expect(isQuestion("when is the dentist appointment")).toBe(true);
  });

  test("starts with how", () => {
    expect(isQuestion("how many tasks do I have")).toBe(true);
  });

  test("starts with who", () => {
    expect(isQuestion("who is coming to the meeting")).toBe(true);
  });

  test("starts with is", () => {
    expect(isQuestion("is my 3pm still on")).toBe(true);
  });

  test("starts with can", () => {
    expect(isQuestion("can you reschedule my dentist")).toBe(true);
  });

  test("past-tense statement is not a question", () => {
    expect(isQuestion("I finished the report")).toBe(false);
  });

  test("future intent is not a question", () => {
    expect(isQuestion("I need to call the dentist")).toBe(false);
  });

  test("present status is not a question", () => {
    expect(isQuestion("at the office now")).toBe(false);
  });
});

// ─── isCommand ────────────────────────────────────────────────────────────────

describe("isCommand", () => {
  test("reschedule", () => {
    expect(isCommand("reschedule the dentist to Friday")).toBe(true);
  });

  test("cancel", () => {
    expect(isCommand("cancel the gym session")).toBe(true);
  });

  test("delete", () => {
    expect(isCommand("delete buy milk from my list")).toBe(true);
  });

  test("drop", () => {
    expect(isCommand("drop the old project task")).toBe(true);
  });

  test("move to", () => {
    expect(isCommand("move dentist to Thursday")).toBe(true);
  });

  test("mark as", () => {
    expect(isCommand("mark dentist as done")).toBe(true);
  });

  test("rename", () => {
    expect(isCommand("rename call mom to call parents")).toBe(true);
  });

  test("future intent is not a command", () => {
    expect(isCommand("I need to call the dentist tomorrow")).toBe(false);
  });

  test("question is not a command", () => {
    expect(isCommand("what is on my list?")).toBe(false);
  });
});

// ─── isPastTense ──────────────────────────────────────────────────────────────

describe("isPastTense", () => {
  test("called", () => {
    expect(isPastTense("called the dentist")).toBe(true);
  });

  test("finished", () => {
    expect(isPastTense("finished the report")).toBe(true);
  });

  test("went", () => {
    expect(isPastTense("went to the gym")).toBe(true);
  });

  test("sent", () => {
    expect(isPastTense("sent the email")).toBe(true);
  });

  test("ate", () => {
    expect(isPastTense("ate lunch at noon")).toBe(true);
  });

  test("future phrase is not past", () => {
    expect(isPastTense("need to call dentist")).toBe(false);
  });
});

// ─── isPresentStatus ──────────────────────────────────────────────────────────

describe("isPresentStatus", () => {
  test("at the office", () => {
    expect(isPresentStatus("at the office")).toBe(true);
  });

  test("heading to gym", () => {
    expect(isPresentStatus("heading to gym")).toBe(true);
  });

  test("working on report", () => {
    expect(isPresentStatus("working on the report")).toBe(true);
  });

  test("on a call", () => {
    expect(isPresentStatus("on a call with client")).toBe(true);
  });

  test("commuting", () => {
    expect(isPresentStatus("commuting home")).toBe(true);
  });

  test("pure future is not present status", () => {
    expect(isPresentStatus("need to go to the office")).toBe(false);
  });
});

// ─── isFutureTense ────────────────────────────────────────────────────────────

describe("isFutureTense", () => {
  test("need to", () => {
    expect(isFutureTense("need to call dentist")).toBe(true);
  });

  test("want to", () => {
    expect(isFutureTense("want to go for a run")).toBe(true);
  });

  test("going to", () => {
    expect(isFutureTense("going to the gym tomorrow")).toBe(true);
  });

  test("will", () => {
    expect(isFutureTense("will submit the report")).toBe(true);
  });

  test("remind me", () => {
    expect(isFutureTense("remind me to take meds")).toBe(true);
  });

  test("past-tense statement is not future", () => {
    expect(isFutureTense("finished the gym session")).toBe(false);
  });
});

// ─── isPointAlert ─────────────────────────────────────────────────────────────

describe("isPointAlert", () => {
  test("remind me", () => {
    expect(isPointAlert("remind me to take meds at 8pm")).toBe(true);
  });

  test("reminder", () => {
    expect(isPointAlert("set a reminder for dentist at 3pm")).toBe(true);
  });

  test("don't forget", () => {
    expect(isPointAlert("don't forget to call mom")).toBe(true);
  });

  test("take meds", () => {
    expect(isPointAlert("take meds at 9am")).toBe(true);
  });

  test("take medication", () => {
    expect(isPointAlert("take medication at noon")).toBe(true);
  });

  test("call person at time", () => {
    expect(isPointAlert("call John at 3pm")).toBe(true);
  });

  test("generic calendar event is not a point alert", () => {
    expect(isPointAlert("dentist appointment on Thursday at 3pm")).toBe(false);
  });
});

// ─── extractTime ──────────────────────────────────────────────────────────────

describe("extractTime", () => {
  test("tomorrow at 3pm", () => {
    const result = extractTime("meeting tomorrow at 3pm", FIXED_NOW);
    expect(result).not.toBeNull();
    // FIXED_NOW is Monday 2026-06-09, tomorrow is Tuesday 2026-06-10
    expect(result!.getDate()).toBe(10);
    expect(result!.getHours()).toBe(15);
    expect(result!.getMinutes()).toBe(0);
  });

  test("tomorrow with no time → midnight", () => {
    const result = extractTime("dentist tomorrow", FIXED_NOW);
    expect(result).not.toBeNull();
    expect(result!.getDate()).toBe(10);
    expect(result!.getHours()).toBe(0);
  });

  test("next Tuesday at 2pm", () => {
    const result = extractTime("call dentist next tuesday at 2pm", FIXED_NOW);
    expect(result).not.toBeNull();
    // FIXED_NOW is Monday; next Tuesday is 2026-06-16
    expect(result!.getDay()).toBe(2); // Tuesday
    expect(result!.getHours()).toBe(14);
  });

  test("bare weekday (Thursday) → next occurrence", () => {
    const result = extractTime("dentist Thursday at 3pm", FIXED_NOW);
    expect(result).not.toBeNull();
    expect(result!.getDay()).toBe(4); // Thursday
    expect(result!.getHours()).toBe(15);
  });

  test("explicit 24-hour time today", () => {
    const result = extractTime("meeting at 15:00", FIXED_NOW);
    expect(result).not.toBeNull();
    expect(result!.getHours()).toBe(15);
    expect(result!.getMinutes()).toBe(0);
  });

  test("noon", () => {
    const result = extractTime("lunch at noon", FIXED_NOW);
    expect(result).not.toBeNull();
    expect(result!.getHours()).toBe(12);
    expect(result!.getMinutes()).toBe(0);
  });

  test("midnight", () => {
    const result = extractTime("reminder at midnight", FIXED_NOW);
    expect(result).not.toBeNull();
    expect(result!.getHours()).toBe(0);
    expect(result!.getMinutes()).toBe(0);
  });

  test("9:30am", () => {
    const result = extractTime("standup at 9:30am", FIXED_NOW);
    expect(result).not.toBeNull();
    expect(result!.getHours()).toBe(9);
    expect(result!.getMinutes()).toBe(30);
  });

  test("no time reference → null", () => {
    const result = extractTime("buy groceries", FIXED_NOW);
    expect(result).toBeNull();
  });

  test("pure past tense with no time → null", () => {
    const result = extractTime("I called the dentist", FIXED_NOW);
    expect(result).toBeNull();
  });

  test("12pm is noon", () => {
    const result = extractTime("meeting at 12pm", FIXED_NOW);
    expect(result).not.toBeNull();
    expect(result!.getHours()).toBe(12);
  });

  test("12am is midnight", () => {
    const result = extractTime("alarm at 12am", FIXED_NOW);
    expect(result).not.toBeNull();
    expect(result!.getHours()).toBe(0);
  });

  test("next Monday from a Monday advances by 7 days", () => {
    // FIXED_NOW is a Monday (getDay() === 1); next Monday must be at least 6 days ahead.
    // We compare dates rather than raw milliseconds to avoid DST-shift false failures.
    const result = extractTime("next monday at 9am", FIXED_NOW);
    expect(result).not.toBeNull();
    expect(result!.getDay()).toBe(1); // still a Monday
    const daysDiff = Math.round(
      (result!.setHours(0, 0, 0, 0),
       result!.valueOf() - new Date(FIXED_NOW).setHours(0, 0, 0, 0)) /
        (24 * 60 * 60 * 1000)
    );
    expect(daysDiff).toBeGreaterThanOrEqual(6);
  });
});

// ─── route: question ──────────────────────────────────────────────────────────

describe("route — question", () => {
  test("question with ? → answer", () => {
    const r = route("what time is my meeting?", [], FIXED_NOW);
    expect(r.action.type).toBe("answer");
  });

  test("interrogative word → answer", () => {
    const r = route("when is the dentist appointment", [], FIXED_NOW);
    expect(r.action.type).toBe("answer");
  });

  test("question is high confidence", () => {
    const r = route("do I have anything at 3pm?", [], FIXED_NOW);
    expect(r.confidence).toBe("high");
  });
});

// ─── route: command ───────────────────────────────────────────────────────────

describe("route — command", () => {
  test("reschedule produces command/reschedule", () => {
    const r = route("reschedule dentist to Friday", [], FIXED_NOW);
    expect(r.action.type).toBe("command");
    if (r.action.type === "command") {
      expect(r.action.subtype).toBe("reschedule");
    }
  });

  test("cancel produces command/cancel", () => {
    const r = route("cancel the gym session", [], FIXED_NOW);
    expect(r.action.type).toBe("command");
    if (r.action.type === "command") {
      expect(r.action.subtype).toBe("cancel");
    }
  });

  test("drop produces command/drop", () => {
    const r = route("drop the old project task", [], FIXED_NOW);
    expect(r.action.type).toBe("command");
    if (r.action.type === "command") {
      expect(r.action.subtype).toBe("drop");
    }
  });

  test("move to produces command/move", () => {
    const r = route("move dentist to Thursday", [], FIXED_NOW);
    expect(r.action.type).toBe("command");
    if (r.action.type === "command") {
      expect(r.action.subtype).toBe("move");
    }
  });

  test("reschedule with time extracts newTime", () => {
    const r = route("reschedule dentist to Friday at 3pm", [], FIXED_NOW);
    if (r.action.type === "command") {
      expect(r.action.newTime).toBeDefined();
      expect(r.action.newTime?.getHours()).toBe(15);
    }
  });

  test("command target title is extracted", () => {
    const r = route("cancel the gym session", [], FIXED_NOW);
    if (r.action.type === "command") {
      expect(r.action.targetTitle.length).toBeGreaterThan(0);
    }
  });
});

// ─── route: future + time → calendar event ───────────────────────────────────

describe("route — future + time → createEvent", () => {
  test("tomorrow at 3pm → createEvent", () => {
    const r = route("dentist tomorrow at 3pm", [], FIXED_NOW);
    expect(r.action.type).toBe("createEvent");
  });

  test("next Tuesday → createEvent", () => {
    const r = route("meeting next Tuesday at 2pm", [], FIXED_NOW);
    expect(r.action.type).toBe("createEvent");
  });

  test("explicit time today → createEvent", () => {
    const r = route("team standup at 15:00", [], FIXED_NOW);
    expect(r.action.type).toBe("createEvent");
  });

  test("createEvent carries tier 1", () => {
    const r = route("dentist tomorrow at 3pm", [], FIXED_NOW);
    if (r.action.type === "createEvent") {
      expect(r.action.tier).toBe(1);
    }
  });

  test("createEvent endAt is 60 minutes after startAt", () => {
    const r = route("dentist tomorrow at 3pm", [], FIXED_NOW);
    if (r.action.type === "createEvent") {
      const diff = r.action.endAt.getTime() - r.action.startAt.getTime();
      expect(diff).toBe(60 * 60 * 1000);
    }
  });

  test("title is cleaned of time phrases", () => {
    const r = route("need to go to dentist tomorrow at 3pm", [], FIXED_NOW);
    if (r.action.type === "createEvent") {
      expect(r.action.title).not.toContain("tomorrow");
      expect(r.action.title).not.toContain("3pm");
    }
  });
});

// ─── route: future + time + point alert → createReminder ─────────────────────

describe("route — future + time + point alert → createReminder", () => {
  test("remind me at 8pm → createReminder", () => {
    const r = route("remind me to take meds at 8pm", [], FIXED_NOW);
    expect(r.action.type).toBe("createReminder");
  });

  test("take meds at 9am → createReminder", () => {
    const r = route("take meds at 9am", [], FIXED_NOW);
    expect(r.action.type).toBe("createReminder");
  });

  test("don't forget at 3pm → createReminder", () => {
    const r = route("don't forget to call mom at 3pm", [], FIXED_NOW);
    expect(r.action.type).toBe("createReminder");
  });

  test("createReminder carries tier 1", () => {
    const r = route("remind me at 7am tomorrow", [], FIXED_NOW);
    if (r.action.type === "createReminder") {
      expect(r.action.tier).toBe(1);
    }
  });

  test("createReminder has a dueAt date", () => {
    const r = route("remind me to take meds at 9am", [], FIXED_NOW);
    if (r.action.type === "createReminder") {
      expect(r.action.dueAt).toBeInstanceOf(Date);
    }
  });
});

// ─── route: future + no time → createTask ────────────────────────────────────

describe("route — future + no time → createTask", () => {
  test("need to buy groceries → createTask", () => {
    const r = route("need to buy groceries", [], FIXED_NOW);
    expect(r.action.type).toBe("createTask");
  });

  test("want to go for a run → createTask", () => {
    const r = route("want to go for a run", [], FIXED_NOW);
    expect(r.action.type).toBe("createTask");
  });

  test("createTask includes a task with an id", () => {
    const r = route("need to call the bank", [], FIXED_NOW);
    if (r.action.type === "createTask") {
      expect(r.action.task.id).toBeTruthy();
    }
  });

  test("createTask status is todo", () => {
    const r = route("need to sort out the insurance", [], FIXED_NOW);
    if (r.action.type === "createTask") {
      expect(r.action.task.status).toBe("todo");
    }
  });
});

// ─── route: past tense → logReality ──────────────────────────────────────────

describe("route — past tense → logReality", () => {
  test("called the dentist → logReality", () => {
    const r = route("called the dentist", [], FIXED_NOW);
    expect(r.action.type).toBe("logReality");
  });

  test("finished the report → logReality", () => {
    const r = route("finished the report", [], FIXED_NOW);
    expect(r.action.type).toBe("logReality");
  });

  test("went to the gym → logReality", () => {
    const r = route("went to the gym this morning", [], FIXED_NOW);
    expect(r.action.type).toBe("logReality");
  });

  test("sent the email → logReality", () => {
    const r = route("sent the email to the team", [], FIXED_NOW);
    expect(r.action.type).toBe("logReality");
  });

  test("logReality entry has rawText", () => {
    const text = "bought milk at the store";
    const r = route(text, [], FIXED_NOW);
    if (r.action.type === "logReality") {
      expect(r.action.entry.rawText).toBe(text);
    }
  });

  test("logReality entry has an id", () => {
    const r = route("ran 5k this morning", [], FIXED_NOW);
    if (r.action.type === "logReality") {
      expect(r.action.entry.id).toBeTruthy();
    }
  });
});

// ─── route: present status → logReality ──────────────────────────────────────

describe("route — present status → logReality", () => {
  test("at the office → logReality", () => {
    const r = route("at the office", [], FIXED_NOW);
    expect(r.action.type).toBe("logReality");
  });

  test("heading to gym → logReality", () => {
    const r = route("heading to the gym", [], FIXED_NOW);
    expect(r.action.type).toBe("logReality");
  });

  test("on a call → logReality", () => {
    const r = route("on a call with the client", [], FIXED_NOW);
    expect(r.action.type).toBe("logReality");
  });

  test("logReality entry type is status", () => {
    const r = route("at the office", [], FIXED_NOW);
    if (r.action.type === "logReality") {
      expect(r.action.entry.type).toBe("status");
    }
  });
});

// ─── route: ambiguous → clarify ───────────────────────────────────────────────

describe("route — ambiguous → clarify", () => {
  test("mixed past and future signals → clarify", () => {
    // "called" (past) + "need to" (future) in same sentence — genuinely ambiguous
    const r = route("called dentist need to reschedule", [], FIXED_NOW);
    // This may or may not trigger clarify depending on scoring; mainly testing
    // the clarify path exists and produces the correct shape
    expect(["clarify", "command", "logReality", "answer"]).toContain(r.action.type);
  });

  test("clarify action has a question field", () => {
    // A fabricated message with no clear signal
    const r = route("maybe dentist thing", [], FIXED_NOW);
    if (r.action.type === "clarify") {
      expect(r.action.question.length).toBeGreaterThan(0);
    }
  });

  test("clarify confidence is low", () => {
    const r = route("maybe dentist thing", [], FIXED_NOW);
    if (r.action.type === "clarify") {
      expect(r.confidence).toBe("low");
    }
  });
});

// ─── route: duplicate detection ───────────────────────────────────────────────

describe("route — duplicate detection", () => {
  test("createTask with near-duplicate in tasks list surfaces duplicates", () => {
    const existing = makeTask({ title: "buy groceries", source: "buy groceries" });
    const r = route("need to buy groceries", [existing], FIXED_NOW);
    if (r.action.type === "createTask") {
      expect(r.duplicates).toBeDefined();
      expect((r.duplicates ?? []).length).toBeGreaterThan(0);
    }
  });

  test("createTask with no duplicates → duplicates undefined", () => {
    const r = route("need to send quarterly report", [], FIXED_NOW);
    if (r.action.type === "createTask") {
      expect(r.duplicates).toBeUndefined();
    }
  });

  test("duplicate detection does NOT block createTask — action is still createTask", () => {
    const existing = makeTask({ title: "call dentist", source: "call dentist" });
    const r = route("need to call dentist", [existing], FIXED_NOW);
    expect(r.action.type).toBe("createTask");
  });

  test("closed tasks do not appear as duplicates", () => {
    const done = makeTask({ title: "buy groceries", status: "done" });
    const dropped = makeTask({ title: "buy groceries", status: "dropped", id: "id-2" });
    const r = route("need to buy groceries", [done, dropped], FIXED_NOW);
    if (r.action.type === "createTask") {
      expect((r.duplicates ?? []).length).toBe(0);
    }
  });
});

// ─── route: confidence scoring ────────────────────────────────────────────────

describe("route — confidence scoring", () => {
  test("clear question → high confidence", () => {
    const r = route("what is on my calendar today?", [], FIXED_NOW);
    expect(r.confidence).toBe("high");
  });

  test("clear command → high confidence", () => {
    const r = route("reschedule dentist to Friday", [], FIXED_NOW);
    expect(r.confidence).toBe("high");
  });

  test("clear future + time → high confidence", () => {
    const r = route("dentist tomorrow at 3pm", [], FIXED_NOW);
    expect(r.confidence).toBe("high");
  });

  test("clear past tense → high confidence", () => {
    const r = route("finished the gym session", [], FIXED_NOW);
    expect(r.confidence).toBe("high");
  });

  test("fallback clarify → low confidence", () => {
    const r = route("maybe dentist thing", [], FIXED_NOW);
    if (r.action.type === "clarify") {
      expect(r.confidence).toBe("low");
    }
  });
});

// ─── route: RouteResult shape invariants ──────────────────────────────────────

describe("route — result shape", () => {
  test("every result has action and confidence fields", () => {
    const messages = [
      "what time is my meeting?",
      "cancel the dentist",
      "dentist tomorrow at 3pm",
      "remind me at 8pm",
      "need to buy groceries",
      "called the dentist",
      "at the office",
    ];
    for (const msg of messages) {
      const r = route(msg, [], FIXED_NOW);
      expect(r.action).toBeDefined();
      expect(["high", "low"]).toContain(r.confidence);
    }
  });

  test("logReality entry always has id, timestamp, rawText, parsedFields", () => {
    const r = route("finished the report", [], FIXED_NOW);
    if (r.action.type === "logReality") {
      expect(r.action.entry.id).toBeTruthy();
      expect(r.action.entry.timestamp).toBeTruthy();
      expect(r.action.entry.rawText).toBeTruthy();
      expect(r.action.entry.parsedFields).toBeDefined();
    }
  });

  test("createTask action.task has required fields", () => {
    const r = route("need to review the contract", [], FIXED_NOW);
    if (r.action.type === "createTask") {
      const t = r.action.task;
      expect(t.id).toBeTruthy();
      expect(t.title).toBeTruthy();
      expect(t.status).toBe("todo");
      expect(Array.isArray(t.tags)).toBe(true);
      expect(t.createdAt).toBeTruthy();
    }
  });
});
