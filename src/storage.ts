import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import type {
  Task,
  ActivityEntry,
  CalendarMirrorEntry,
  CurrentState,
  PolicyConfig,
  InboxEntry,
} from "./types.js";

// ─── Internals ───────────────────────────────────────────────────────────────

// Allow tests to redirect DATA_DIR via env var so they never touch the real
// data/ directory and can run in an isolated temp location.
const DATA_DIR =
  process.env["PERSONAL_ASSISTANT_DATA_DIR"] ?? resolve(import.meta.dir, "../data");

function dataPath(filename: string): string {
  return resolve(DATA_DIR, filename);
}

/**
 * Atomic write: serialise to a .tmp file then rename into place so a crash
 * mid-write never leaves a corrupt or empty JSON file on disk.
 */
function atomicWrite(filePath: string, value: unknown): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  renameSync(tmp, filePath);
}

/**
 * Read and parse a JSON file. Returns `null` when the file does not exist or
 * contains malformed JSON so callers can decide on their own safe default
 * rather than throwing.
 */
function readJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export function readTasks(): Task[] {
  return readJson<Task[]>(dataPath("tasks.json")) ?? [];
}

export function writeTasks(tasks: Task[]): void {
  atomicWrite(dataPath("tasks.json"), tasks);
}

// ─── Activity Log ─────────────────────────────────────────────────────────────

export function readActivityLog(): ActivityEntry[] {
  return readJson<ActivityEntry[]>(dataPath("activity-log.json")) ?? [];
}

export function writeActivityLog(entries: ActivityEntry[]): void {
  atomicWrite(dataPath("activity-log.json"), entries);
}

/**
 * Convenience: append a single ActivityEntry without the caller needing to
 * read-modify-write the full array.
 */
export function appendActivityEntry(entry: ActivityEntry): void {
  const current = readActivityLog();
  current.push(entry);
  writeActivityLog(current);
}

// ─── Calendar Mirror ──────────────────────────────────────────────────────────

export function readCalendarMirror(): CalendarMirrorEntry[] {
  return readJson<CalendarMirrorEntry[]>(dataPath("calendar-mirror.json")) ?? [];
}

export function writeCalendarMirror(entries: CalendarMirrorEntry[]): void {
  atomicWrite(dataPath("calendar-mirror.json"), entries);
}

// ─── Current State ────────────────────────────────────────────────────────────

const DEFAULT_CURRENT_STATE: CurrentState = {
  lastObservation: "",
  lastObservedAt: new Date(0).toISOString(),
  staleness: "unknown",
};

export function readCurrentState(): CurrentState {
  return readJson<CurrentState>(dataPath("current-state.json")) ?? { ...DEFAULT_CURRENT_STATE };
}

export function writeCurrentState(state: CurrentState): void {
  atomicWrite(dataPath("current-state.json"), state);
}

// ─── Policy Config ────────────────────────────────────────────────────────────

const DEFAULT_POLICY: PolicyConfig = {
  allowedWindows: [],
  blackoutWindows: [],
  bufferMinutes: 15,
  dailyCap: 5,
  staleAfterHours: 12,
  defaultPriority: 2,
};

export function readPolicy(): PolicyConfig {
  return readJson<PolicyConfig>(dataPath("policy.json")) ?? { ...DEFAULT_POLICY };
}

export function writePolicy(policy: PolicyConfig): void {
  atomicWrite(dataPath("policy.json"), policy);
}

// ─── Inbox ───────────────────────────────────────────────────────────────────

export function readInbox(): InboxEntry[] {
  return readJson<InboxEntry[]>(dataPath("inbox.json")) ?? [];
}

export function writeInbox(entries: InboxEntry[]): void {
  atomicWrite(dataPath("inbox.json"), entries);
}

/**
 * Convenience: append a single InboxEntry without the caller needing to
 * read-modify-write the full array.
 */
export function appendInboxEntry(entry: InboxEntry): void {
  const current = readInbox();
  current.push(entry);
  writeInbox(current);
}
