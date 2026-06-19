// ─── Task (Intent layer) ──────────────────────────────────────────────────────

export type TaskStatus = "todo" | "scheduled" | "done" | "dropped" | "skipped";

export type Task = {
  id: string; // uuid
  title: string;
  status: TaskStatus;
  priority: 1 | 2 | 3; // 1=high, 2=medium, 3=low
  estimatedMinutes?: number;
  recurrenceRule?: string; // iCal RRULE string, only for Tier 2 tasks
  tags: string[];
  source: string; // raw message that created it
  createdAt: string; // ISO 8601
  scheduledAt?: string; // ISO 8601, set when status → scheduled
  completedAt?: string; // ISO 8601
  skippedAt?: string; // ISO 8601
};

// ─── ActivityEntry (Reality layer) ───────────────────────────────────────────

export type ActivityType = "status" | "completed" | "started" | "note";

export type ActivityEntry = {
  id: string;
  timestamp: string; // ISO 8601 — system clock at receipt unless user supplied
  type: ActivityType;
  rawText: string; // verbatim user message
  parsedFields: Record<string, string>; // extracted structured fields
  closedTaskId?: string; // if this entry closes an intent
};

// ─── CalendarMirrorEntry (Plan layer — audit/undo) ───────────────────────────

export type CalendarMirrorEntry = {
  id: string;
  externalId: string; // Apple Calendar / Reminders event ID
  title: string;
  startAt: string; // ISO 8601
  endAt?: string; // ISO 8601 — absent for Reminders
  isReminder: boolean;
  tier: 0 | 1 | 2 | 3; // autonomy tier that created it
  createdAt: string;
  undone: boolean;
  completedByUser?: string; // ISO 8601 — set when user marks reminder complete in Reminders app
};

// ─── CurrentState ─────────────────────────────────────────────────────────────

export type StalenessLevel = "fresh" | "stale" | "unknown";

export type CurrentState = {
  lastObservation: string; // raw text of last reality ping
  lastObservedAt: string; // ISO 8601
  staleness: StalenessLevel; // computed from staleAfterHours window
  location?: string;
  activity?: string;
};

// ─── PolicyConfig (Issue #8 will expand this) ────────────────────────────────

// HH:MM start/end, days where 0=Sunday … 6=Saturday
export type TimeWindow = { start: string; end: string; days: number[] };

export type PolicyConfig = {
  allowedWindows: TimeWindow[];
  blackoutWindows: TimeWindow[];
  bufferMinutes: number;
  dailyCap: number; // max Tier 2 auto-schedules per day
  staleAfterHours: number; // default 12
  defaultPriority: 1 | 2 | 3;
};

// ─── InboxEntry (raw captures before parsing) ────────────────────────────────

export type InboxEntry = {
  id: string;
  receivedAt: string; // ISO 8601
  rawText: string;
  processed: boolean;
};
