import { trackEvent } from "./analytics";

// Learns what a user likes from their own 👍/👎 votes — no accounts, no ML
// infra, just localStorage tallies. Three signals, each with a minimum vote
// threshold so early noise doesn't steer suggestions:
//   1. tone affinity (which suggestion tones they up/downvote),
//   2. message length (avg chars of liked vs disliked),
//   3. emoji appetite (share of liked vs disliked containing emoji).
// The client summarizes this into a prompt-ready paragraph sent with every
// generation (see SuggestRequestBody.tasteProfile), plus a one-line highlight
// shown in the UI so users see their votes matter.

export interface TasteVote {
  tone: string;
  text: string;
  vote: "up" | "down";
  at: string; // ISO timestamp
}

export interface TasteSummary {
  summary: string;
  highlight: string;
  totalVotes: number;
}

const STORAGE_KEY = "dca_taste_votes_v0";
const MAX_STORED = 100;
const MIN_TOTAL_VOTES = 3;
const MIN_TONE_VOTES = 3;
const MIN_SIDE_VOTES = 2;
const LENGTH_DIFF_CHARS = 30;
const EMOJI_RATE_DIFF = 0.4;

// Broad emoji match: pictographs, symbols, dingbats, variation selectors.
const EMOJI_PATTERN = /[🌀-🫿☀-➿⬀-⯿️]/u;

export function hasEmoji(text: string): boolean {
  return EMOJI_PATTERN.test(text);
}

export function getTasteVotes(): TasteVote[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as TasteVote[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function recordTasteVote(vote: Omit<TasteVote, "at">): void {
  if (typeof window === "undefined") return;
  const entry: TasteVote = { ...vote, at: new Date().toISOString() };
  const prev = getTasteVotes();
  const next = [...prev, entry].slice(-MAX_STORED);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  // Fire once, the first time votes crystallize into a usable profile.
  if (!summarizeTaste(prev) && summarizeTaste(next)) {
    trackEvent("taste_learned", { totalVotes: next.length });
  }
}

function prettyTone(tone: string): string {
  return tone.replace(/_/g, " ");
}

export function summarizeTaste(votes: TasteVote[] = getTasteVotes()): TasteSummary | null {
  if (votes.length < MIN_TOTAL_VOTES) return null;

  const lovedTones: string[] = [];
  const dislikedTones: string[] = [];
  const byTone = new Map<string, { up: number; down: number }>();
  for (const v of votes) {
    const entry = byTone.get(v.tone) ?? { up: 0, down: 0 };
    if (v.vote === "up") entry.up += 1;
    else entry.down += 1;
    byTone.set(v.tone, entry);
  }
  for (const [tone, { up, down }] of byTone) {
    const total = up + down;
    if (total < MIN_TONE_VOTES) continue;
    const rate = up / total;
    if (rate >= 0.67) lovedTones.push(prettyTone(tone));
    else if (rate <= 0.33) dislikedTones.push(prettyTone(tone));
  }

  const ups = votes.filter((v) => v.vote === "up");
  const downs = votes.filter((v) => v.vote === "down");

  let lengthLine: string | null = null;
  let lengthHighlight: string | null = null;
  if (ups.length >= MIN_SIDE_VOTES && downs.length >= MIN_SIDE_VOTES) {
    const avgUp = ups.reduce((sum, v) => sum + v.text.length, 0) / ups.length;
    const avgDown = downs.reduce((sum, v) => sum + v.text.length, 0) / downs.length;
    if (avgUp + LENGTH_DIFF_CHARS <= avgDown) {
      lengthLine = `Prefers shorter messages (liked ones average ~${Math.round(avgUp)} chars).`;
      lengthHighlight = "shorter messages";
    } else if (avgDown + LENGTH_DIFF_CHARS <= avgUp) {
      lengthLine = `Prefers longer, fuller messages (liked ones average ~${Math.round(avgUp)} chars).`;
      lengthHighlight = "longer messages";
    }
  }

  let emojiLine: string | null = null;
  let emojiHighlight: string | null = null;
  if (ups.length >= MIN_SIDE_VOTES && downs.length >= MIN_SIDE_VOTES) {
    const upRate = ups.filter((v) => hasEmoji(v.text)).length / ups.length;
    const downRate = downs.filter((v) => hasEmoji(v.text)).length / downs.length;
    if (upRate - downRate >= EMOJI_RATE_DIFF) {
      emojiLine = "Likes messages with emoji.";
      emojiHighlight = "messages with emoji";
    } else if (downRate - upRate >= EMOJI_RATE_DIFF) {
      emojiLine = "Prefers messages without emoji.";
      emojiHighlight = "messages without emoji";
    }
  }

  const lines: string[] = [];
  if (lovedTones.length > 0) lines.push(`Leans toward the ${lovedTones.join(", ")} tone.`);
  if (dislikedTones.length > 0) lines.push(`Steer away from the ${dislikedTones.join(", ")} tone.`);
  if (lengthLine) lines.push(lengthLine);
  if (emojiLine) lines.push(emojiLine);
  if (lines.length === 0) return null;

  const highlights: string[] = [
    ...lovedTones,
    ...(lengthHighlight ? [lengthHighlight] : []),
    ...(emojiHighlight ? [emojiHighlight] : []),
  ];

  return {
    summary: `LEARNED TASTE (from ${votes.length} past 👍/👎 votes by this user — steer toward what they demonstrably like):\n- ${lines.join("\n- ")}`,
    highlight: `Learned from ${votes.length} votes: prefers ${highlights.join(", ")} 👍`,
    totalVotes: votes.length,
  };
}
