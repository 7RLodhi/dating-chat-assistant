import { PendingOutcome } from "./types";

// Queue of copied suggestions awaiting a "did it work well?" answer. Stored
// in localStorage (same tier as everything else in v0 — no accounts).
//
// A nudge becomes due through behavior, not a timer: when the user opens the
// SAME match again and the chat has grown since the copy (i.e. the
// conversation moved forward, so there's plausibly a reply to report on).
// "Ask me later" snoozes for the rest of the visit only (sessionStorage),
// so it reappears on the next visit.

const STORAGE_KEY = "dca_outcomes_v0";
const SNOOZE_KEY = "dca_outcome_snoozed_v0";

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

function getSnoozedThisVisit(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(SNOOZE_KEY);
    const parsed = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Hides the nudge until the next visit (page load). */
export function snoozeOutcomeForVisit(id: string): void {
  if (typeof window === "undefined") return;
  const snoozed = getSnoozedThisVisit();
  if (!snoozed.includes(id)) {
    window.sessionStorage.setItem(SNOOZE_KEY, JSON.stringify([...snoozed, id]));
  }
}

/**
 * Due outcomes for the currently open match: same match, chat grown since
 * the copy, not snoozed this visit. Oldest first.
 */
export function getDueOutcomes(
  matchId: string | null,
  rowCount: number
): PendingOutcome[] {
  if (!matchId) return [];
  const snoozed = new Set(getSnoozedThisVisit());
  return getPendingOutcomes()
    .filter(
      (o) =>
        o.matchId === matchId &&
        !snoozed.has(o.id) &&
        rowCount > (o.rowsAtCopy ?? 0)
    )
    .sort((a, b) => a.copiedAt.localeCompare(b.copiedAt));
}

export function resolveOutcome(id: string): void {
  savePending(getPendingOutcomes().filter((o) => o.id !== id));
}
