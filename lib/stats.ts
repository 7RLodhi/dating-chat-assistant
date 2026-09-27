import { readJSONLines } from "./devStore";
import { getSupabase, isSupabaseConfigured } from "./supabase";

// Read-only analytics over the existing log tables (generations, feedback,
// outcomes). No new writes, no schema changes — generations carry no match
// attribution, so per-match stats are built from outcomes (which carry
// matchName + generationId) joined back into generations.

export interface MoodPoint {
  at: string;
  mood: string;
}

export interface MatchStats {
  name: string;
  asked: number;
  replied: number;
  rate: number;
  tried: number;
  moods: MoodPoint[];
  replyTones: { tone: string; count: number }[];
}

export interface ToneStats {
  tone: string;
  up: number;
  down: number;
  asked: number;
  replied: number;
}

export interface ApproachStats {
  approach: string;
  up: number;
  down: number;
}

export interface StatsResponse {
  totals: {
    generations: number;
    votesUp: number;
    votesDown: number;
    outcomesAsked: number;
    outcomesReplied: number;
    replyRate: number;
  };
  moodTrajectory: MoodPoint[];
  perMatch: MatchStats[];
  tones: ToneStats[];
  approaches: ApproachStats[];
}

interface GenRow {
  id?: string;
  at: string;
  mood?: string;
  suggestions: { text: string; tone: string; approach: string }[];
}

interface FbRow {
  suggestionText: string;
  tone: string;
  approach: string;
  vote: "up" | "down";
}

interface OutRow {
  generationId?: string;
  matchName?: string;
  suggestionText: string;
  replied: boolean;
  at: string;
}

const ROW_LIMIT = 2000;

async function loadRows(): Promise<{ gens: GenRow[]; fbs: FbRow[]; outs: OutRow[] }> {
  if (isSupabaseConfigured()) {
    const supabase = getSupabase()!;
    const [g, f, o] = await Promise.all([
      supabase
        .from("generations")
        .select("id, conversation_read, suggestions, created_at")
        .order("created_at", { ascending: true })
        .limit(ROW_LIMIT),
      supabase
        .from("feedback")
        .select("suggestion_text, tone, approach, vote, created_at")
        .order("created_at", { ascending: true })
        .limit(ROW_LIMIT),
      supabase
        .from("outcomes")
        .select("generation_id, match_name, suggestion_text, replied, created_at")
        .order("created_at", { ascending: true })
        .limit(ROW_LIMIT),
    ]);
    const gens: GenRow[] = (g.data ?? []).map((r) => ({
      id: String(r.id ?? ""),
      at: String(r.created_at ?? ""),
      mood: (r.conversation_read as { mood_label?: string } | null)?.mood_label,
      suggestions: Array.isArray(r.suggestions)
        ? (r.suggestions as { text?: string; tone?: string; approach?: string }[]).map((s) => ({
            text: String(s.text ?? ""),
            tone: String(s.tone ?? ""),
            approach: String(s.approach ?? ""),
          }))
        : [],
    }));
    const fbs: FbRow[] = (f.data ?? []).map((r) => ({
      suggestionText: String(r.suggestion_text ?? ""),
      tone: String(r.tone ?? ""),
      approach: String(r.approach ?? ""),
      vote: r.vote === "down" ? "down" : "up",
    }));
    const outs: OutRow[] = (o.data ?? []).map((r) => ({
      generationId: r.generation_id ? String(r.generation_id) : undefined,
      matchName: r.match_name ? String(r.match_name) : undefined,
      suggestionText: String(r.suggestion_text ?? ""),
      replied: Boolean(r.replied),
      at: String(r.created_at ?? ""),
    }));
    return { gens, fbs, outs };
  }

  const [gens, fbs, outs] = await Promise.all([
    readJSONLines<{
      id?: string;
      receivedAt?: string;
      conversationRead?: { mood_label?: string };
      suggestions?: { text?: string; tone?: string; approach?: string }[];
    }>("generations.jsonl"),
    readJSONLines<{
      suggestionText?: string;
      tone?: string;
      approach?: string;
      vote?: string;
    }>("feedback.jsonl"),
    readJSONLines<{
      generationId?: string;
      matchName?: string;
      suggestionText?: string;
      replied?: boolean;
      receivedAt?: string;
    }>("outcomes.jsonl"),
  ]);
  return {
    gens: gens.map((r) => ({
      id: r.id,
      at: r.receivedAt ?? "",
      mood: r.conversationRead?.mood_label,
      suggestions: (r.suggestions ?? []).map((s) => ({
        text: String(s.text ?? ""),
        tone: String(s.tone ?? ""),
        approach: String(s.approach ?? ""),
      })),
    })),
    fbs: fbs.map((r) => ({
      suggestionText: String(r.suggestionText ?? ""),
      tone: String(r.tone ?? ""),
      approach: String(r.approach ?? ""),
      vote: r.vote === "down" ? "down" : "up",
    })),
    outs: outs.map((r) => ({
      generationId: r.generationId,
      matchName: r.matchName,
      suggestionText: String(r.suggestionText ?? ""),
      replied: Boolean(r.replied),
      at: r.receivedAt ?? "",
    })),
  };
}

export async function getStats(): Promise<StatsResponse> {
  const { gens, fbs, outs } = await loadRows();

  const genById = new Map<string, GenRow>();
  for (const g of gens) {
    if (g.id) genById.set(g.id, g);
  }
  // Resolve an outcome to the suggestion's tone/approach: generation link
  // first, then a text search across generations as fallback.
  function resolveSuggestion(out: OutRow): { tone: string; approach: string } | null {
    const inGen = (g: GenRow) =>
      g.suggestions.find((s) => s.text === out.suggestionText);
    if (out.generationId) {
      const hit = inGen((genById.get(out.generationId) ?? { at: "", suggestions: [] }) as GenRow);
      if (hit) return hit;
    }
    for (const g of gens) {
      const hit = inGen(g);
      if (hit) return hit;
    }
    return null;
  }

  const votesUp = fbs.filter((f) => f.vote === "up").length;
  const votesDown = fbs.length - votesUp;
  const outcomesReplied = outs.filter((o) => o.replied).length;

  const moodTrajectory: MoodPoint[] = gens
    .filter((g) => g.mood)
    .map((g) => ({ at: g.at, mood: g.mood as string }))
    .slice(-30);

  // Per-match (outcomes are the only match-attributed records).
  const byMatch = new Map<string, OutRow[]>();
  for (const o of outs) {
    const name = o.matchName?.trim();
    if (!name) continue;
    const list = byMatch.get(name) ?? [];
    list.push(o);
    byMatch.set(name, list);
  }
  const perMatch: MatchStats[] = [...byMatch.entries()].map(([name, rows]) => {
    const asked = rows.length;
    const replied = rows.filter((r) => r.replied).length;
    const tried = new Set(rows.map((r) => r.suggestionText)).size;
    const moods: MoodPoint[] = [];
    for (const r of rows) {
      const g = r.generationId ? genById.get(r.generationId) : undefined;
      if (g?.mood) moods.push({ at: g.at || r.at, mood: g.mood });
    }
    moods.sort((a, b) => a.at.localeCompare(b.at));
    const toneCounts = new Map<string, number>();
    for (const r of rows) {
      if (!r.replied) continue;
      const tone = resolveSuggestion(r)?.tone?.trim().toLowerCase();
      if (tone) toneCounts.set(tone, (toneCounts.get(tone) ?? 0) + 1);
    }
    return {
      name,
      asked,
      replied,
      rate: asked > 0 ? replied / asked : 0,
      tried,
      moods: moods.slice(-12),
      replyTones: [...toneCounts.entries()]
        .map(([tone, count]) => ({ tone, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3),
    };
  });
  perMatch.sort((a, b) => b.asked - a.asked || b.replied - a.replied);

  // Tone board: votes from feedback, replies from resolved outcomes.
  const toneMap = new Map<string, ToneStats>();
  const toneOf = (t: string) => {
    const key = t.trim().toLowerCase() || "unknown";
    let e = toneMap.get(key);
    if (!e) {
      e = { tone: key, up: 0, down: 0, asked: 0, replied: 0 };
      toneMap.set(key, e);
    }
    return e;
  };
  for (const f of fbs) {
    const e = toneOf(f.tone);
    if (f.vote === "up") e.up += 1;
    else e.down += 1;
  }
  for (const o of outs) {
    const tone = resolveSuggestion(o)?.tone;
    if (!tone) continue;
    const e = toneOf(tone);
    e.asked += 1;
    if (o.replied) e.replied += 1;
  }
  const tones = [...toneMap.values()].sort(
    (a, b) => b.up + b.down + b.asked - (a.up + a.down + a.asked)
  );

  // Approach board: votes only (approaches aren't reply-tracked separately).
  const approachMap = new Map<string, ApproachStats>();
  for (const f of fbs) {
    const key = f.approach.trim() || "unknown";
    let e = approachMap.get(key);
    if (!e) {
      e = { approach: key, up: 0, down: 0 };
      approachMap.set(key, e);
    }
    if (f.vote === "up") e.up += 1;
    else e.down += 1;
  }
  const approaches = [...approachMap.values()]
    .sort((a, b) => b.up + b.down - (a.up + a.down))
    .slice(0, 12);

  return {
    totals: {
      generations: gens.length,
      votesUp,
      votesDown,
      outcomesAsked: outs.length,
      outcomesReplied,
      replyRate: outs.length > 0 ? outcomesReplied / outs.length : 0,
    },
    moodTrajectory,
    perMatch,
    tones,
    approaches,
  };
}
