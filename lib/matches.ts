// Matches are stored client-side in localStorage — same tier as everything
// else in v0 (no accounts). Each match holds their bio (used to generate
// openers) and a running conversation draft (used to generate replies once
// there's back-and-forth). See AssistantApp.tsx for how "opener vs reply"
// is now inferred from whether conversationText is empty, instead of a
// manual mode toggle.

import { MatchFacts, Tone } from "./types";

export interface Match {
  id: string;
  name: string;
  bio: string;
  conversationText: string;
  createdAt: string;
  facts?: MatchFacts;
  /** First-run sample conversation — bannered in the UI, deletable like any match. */
  demo?: boolean;
  /** Remembered tone chip selection (null/undefined = none selected). */
  tone?: Tone | null;
}

const STORAGE_KEY = "dca_matches_v0";

export function getMatches(): Match[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Match[]) : [];
  } catch {
    return [];
  }
}

function saveMatches(matches: Match[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(matches));
}

export function addMatch(name: string, bio: string, demo = false): Match {
  const match: Match = {
    id: crypto.randomUUID(),
    name: name.trim(),
    bio: bio.trim(),
    conversationText: "",
    createdAt: new Date().toISOString(),
    ...(demo ? { demo: true as const } : {}),
  };
  saveMatches([...getMatches(), match]);
  return match;
}

export function updateMatch(
  id: string,
  patch: Partial<Pick<Match, "name" | "bio" | "conversationText" | "facts" | "demo" | "tone">>
): void {
  saveMatches(getMatches().map((m) => (m.id === id ? { ...m, ...patch } : m)));
}

export function deleteMatch(id: string): void {
  saveMatches(getMatches().filter((m) => m.id !== id));
}
