import { PendingOutcome } from "./types";

// Queue of copied suggestions awaiting a "did they reply?" answer. Stored in
// localStorage (same tier as everything else in v0 — no accounts). A nudge
// becomes due OUTCOME_ASK_AFTER_MS after the copy, so we never ask seconds
// after someone hits Copy.

export const OUTCOME_ASK_AFTER_MS = 2 * 60 * 60 * 1000; // 2 hours

const STORAGE_KEY = "dca_outcomes_v0";

export function getPendingOutcomes(): PendingOutcome[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as PendingOutcome[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePending(outcomes: PendingOutcome[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(outcomes));
}

export function enqueueOutcome(outcome: Omit<PendingOutcome, "id" | "copiedAt">): void {
  const entry: PendingOutcome = {
    ...outcome,
    id: crypto.randomUUID(),
    copiedAt: new Date().toISOString(),
  };
  savePending([...getPendingOutcomes(), entry]);
}

/** Outcomes old enough to ask about, oldest first. */
export function getDueOutcomes(now: number = Date.now()): PendingOutcome[] {
  return getPendingOutcomes()
    .filter((o) => now - new Date(o.copiedAt).getTime() >= OUTCOME_ASK_AFTER_MS)
    .sort((a, b) => a.copiedAt.localeCompare(b.copiedAt));
}

export function resolveOutcome(id: string): void {
  savePending(getPendingOutcomes().filter((o) => o.id !== id));
}

/** Pushes the nudge OUTCOME_ASK_AFTER_MS into the future. */
export function snoozeOutcome(id: string): void {
  savePending(
    getPendingOutcomes().map((o) =>
      o.id === id ? { ...o, copiedAt: new Date().toISOString() } : o
    )
  );
}
