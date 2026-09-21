// Matches are stored client-side in localStorage — same tier as everything
// else in v0 (no accounts). Each match holds their bio (used to generate
// openers) and a running conversation draft (used to generate replies once
// there's back-and-forth). See AssistantApp.tsx for how "opener vs reply"
// is now inferred from whether conversationText is empty, instead of a
// manual mode toggle.

import { MatchFacts } from "./types";

export interface Match {
  id: string;
  name: string;
  bio: string;
  conversationText: string;
  createdAt: string;
  facts?: MatchFacts;
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

export function addMatch(name: string, bio: string): Match {
  const match: Match = {
    id: crypto.randomUUID(),
    name: name.trim(),
    bio: bio.trim(),
    conversationText: "",
    createdAt: new Date().toISOString(),
  };
  saveMatches([...getMatches(), match]);
  return match;
}

export function updateMatch(
  id: string,
  patch: Partial<Pick<Match, "name" | "bio" | "conversationText" | "facts">>
): void {
  saveMatches(getMatches().map((m) => (m.id === id ? { ...m, ...patch } : m)));
}

export function deleteMatch(id: string): void {
  saveMatches(getMatches().filter((m) => m.id !== id));
}
