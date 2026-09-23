import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { appendJSONLine } from "./devStore";
import { NAME_PUN_SEEDS } from "./namePunSeeds";
import { getSupabase, isSupabaseConfigured } from "./supabase";
import {
  ConversationRead,
  Goal,
  Language,
  Mode,
  NamePun,
  PunVote,
  Suggestion,
  Tone,
} from "./types";

// Single persistence layer for everything the v0 needs to log. If Supabase
// is configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY), records go
// there. Otherwise everything falls back to local .data/*.jsonl files so
// local development keeps working with zero setup. See supabase/schema.sql
// for the table definitions.

export interface GenerationRecord {
  id: string;
  mode: Mode;
  tone: Tone;
  goal: Goal;
  inputText: string;
  extraContext?: string;
  conversationRead?: ConversationRead;
  suggestions: Suggestion[];
  model: string;
  styleApplied?: boolean;
  viaScreenshot?: boolean;
  language?: Language;
}

export async function recordGeneration(record: GenerationRecord): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = getSupabase()!;
    const { error } = await supabase.from("generations").insert({
      id: record.id,
      mode: record.mode,
      tone: record.tone,
      goal: record.goal,
      input_text: record.inputText,
      extra_context: record.extraContext ?? null,
      conversation_read: record.conversationRead ?? null,
      suggestions: record.suggestions,
      model: record.model,
      style_applied: record.styleApplied ?? false,
      via_screenshot: record.viaScreenshot ?? false,
      language: record.language ?? "auto",
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.error("Supabase insert (generations) failed:", error.message);
    }
    return;
  }

  await appendJSONLine("generations.jsonl", {
    ...record,
    receivedAt: new Date().toISOString(),
  });
}

export interface FeedbackRecord {
  generationId?: string;
  suggestionText: string;
  tone: string;
  approach: string;
  vote: "up" | "down";
}

export async function recordFeedback(record: FeedbackRecord): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = getSupabase()!;
    const { error } = await supabase.from("feedback").insert({
      generation_id: record.generationId ?? null,
      suggestion_text: record.suggestionText,
      tone: record.tone,
      approach: record.approach,
      vote: record.vote,
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.error("Supabase insert (feedback) failed:", error.message);
    }
    return;
  }

  await appendJSONLine("feedback.jsonl", {
    ...record,
    receivedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Name-pun directory: community puns keyed by first name, with worked /
// not-worked vote counters. Same storage rule as everything else here:
// Supabase when configured, otherwise a local JSON file under .data/.
// ---------------------------------------------------------------------------

const PUNS_FILE = path.join(process.cwd(), ".data", "name_puns.json");

function seedPuns(): NamePun[] {
  const now = new Date().toISOString();
  // Stable ids (not random): on hosts without Supabase the seed list is
  // regenerated in-memory on every request, so ids must be identical across
  // invocations or votes can never match the id the list showed.
  return NAME_PUN_SEEDS.map((s, i) => ({
    id: `seed-${i}`,
    name: s.name,
    pun: s.pun,
    worked: 0,
    notWorked: 0,
    createdAt: now,
  }));
}

async function readLocalPuns(): Promise<NamePun[]> {
  try {
    const raw = await fs.readFile(PUNS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as NamePun[];
    return Array.isArray(parsed) ? parsed : seedPuns();
  } catch {
    const seeded = seedPuns();
    try {
      await fs.mkdir(path.dirname(PUNS_FILE), { recursive: true });
      await fs.writeFile(PUNS_FILE, JSON.stringify(seeded, null, 2), "utf-8");
    } catch {
      // Best-effort only; callers still get the seeded list.
    }
    return seeded;
  }
}

async function writeLocalPuns(puns: NamePun[]): Promise<void> {
  try {
    await fs.mkdir(path.dirname(PUNS_FILE), { recursive: true });
    await fs.writeFile(PUNS_FILE, JSON.stringify(puns, null, 2), "utf-8");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Failed to write name_puns.json:", err);
  }
}

function sortPuns(puns: NamePun[]): NamePun[] {
  return [...puns].sort((a, b) => {
    const scoreA = a.worked - a.notWorked;
    const scoreB = b.worked - b.notWorked;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return a.name.localeCompare(b.name);
  });
}

export async function listNamePuns(search?: string): Promise<NamePun[]> {
  const q = search?.trim().toLowerCase();
  if (isSupabaseConfigured()) {
    const supabase = getSupabase()!;
    let query = supabase
      .from("name_puns")
      .select("id, name, pun, worked, not_worked, created_at")
      .order("worked", { ascending: false })
      .order("name", { ascending: true })
      .limit(100);
    if (q) query = query.ilike("name", `%${q}%`);
    const { data, error } = await query;
    if (error) {
      // eslint-disable-next-line no-console
      console.error("Supabase select (name_puns) failed:", error.message);
      return [];
    }
    return (data ?? []).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      pun: String(row.pun),
      worked: Number(row.worked ?? 0),
      notWorked: Number(row.not_worked ?? 0),
      createdAt: String(row.created_at),
    }));
  }

  const all = await readLocalPuns();
  const filtered = q ? all.filter((p) => p.name.toLowerCase().includes(q)) : all;
  return sortPuns(filtered).slice(0, 100);
}

/** Best community pun for an exact first-name match, if any exists. */
export async function getTopPunForName(name: string): Promise<NamePun | null> {
  const target = name.trim().toLowerCase();
  if (!target) return null;
  if (isSupabaseConfigured()) {
    const supabase = getSupabase()!;
    const { data, error } = await supabase
      .from("name_puns")
      .select("id, name, pun, worked, not_worked, created_at")
      .ilike("name", target)
      .order("worked", { ascending: false })
      .limit(1);
    if (error || !data || data.length === 0) return null;
    const row = data[0];
    return {
      id: String(row.id),
      name: String(row.name),
      pun: String(row.pun),
      worked: Number(row.worked ?? 0),
      notWorked: Number(row.not_worked ?? 0),
      createdAt: String(row.created_at),
    };
  }

  const all = await readLocalPuns();
  const exact = all.filter((p) => p.name.toLowerCase() === target);
  if (exact.length === 0) return null;
  return sortPuns(exact)[0];
}

export async function addNamePun(name: string, pun: string): Promise<NamePun> {
  const entry: NamePun = {
    id: randomUUID(),
    name: name.trim(),
    pun: pun.trim(),
    worked: 0,
    notWorked: 0,
    createdAt: new Date().toISOString(),
  };
  if (isSupabaseConfigured()) {
    const supabase = getSupabase()!;
    const { error } = await supabase.from("name_puns").insert({
      id: entry.id,
      name: entry.name,
      pun: entry.pun,
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.error("Supabase insert (name_puns) failed:", error.message);
      throw new Error("Failed to save your pun. Try again in a moment.");
    }
    return entry;
  }

  const all = await readLocalPuns();
  all.push(entry);
  await writeLocalPuns(all);
  return entry;
}

export async function voteNamePun(id: string, vote: PunVote): Promise<NamePun | null> {
  if (isSupabaseConfigured()) {
    const supabase = getSupabase()!;
    const { data, error: readError } = await supabase
      .from("name_puns")
      .select("id, name, pun, worked, not_worked, created_at")
      .eq("id", id)
      .single();
    if (readError || !data) return null;
    const column = vote === "worked" ? "worked" : "not_worked";
    const { error: updateError } = await supabase
      .from("name_puns")
      .update({ [column]: Number(data[column] ?? 0) + 1 })
      .eq("id", id);
    if (updateError) {
      // eslint-disable-next-line no-console
      console.error("Supabase update (name_puns vote) failed:", updateError.message);
      throw new Error("Failed to record your vote. Try again in a moment.");
    }
    return {
      id: String(data.id),
      name: String(data.name),
      pun: String(data.pun),
      worked: Number(data.worked ?? 0) + (vote === "worked" ? 1 : 0),
      notWorked: Number(data.not_worked ?? 0) + (vote === "notWorked" ? 1 : 0),
      createdAt: String(data.created_at),
    };
  }

  const all = await readLocalPuns();
  const entry = all.find((p) => p.id === id);
  if (!entry) return null;
  if (vote === "worked") entry.worked += 1;
  else entry.notWorked += 1;
  await writeLocalPuns(all);
  return { ...entry };
}

export interface OutcomeRecord {
  generationId?: string;
  matchName?: string;
  suggestionText: string;
  replied: boolean;
}

export async function recordOutcome(record: OutcomeRecord): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = getSupabase()!;
    const { error } = await supabase.from("outcomes").insert({
      generation_id: record.generationId ?? null,
      match_name: record.matchName ?? null,
      suggestion_text: record.suggestionText,
      replied: record.replied,
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.error("Supabase insert (outcomes) failed:", error.message);
    }
    return;
  }

  await appendJSONLine("outcomes.jsonl", {
    ...record,
    receivedAt: new Date().toISOString(),
  });
}

export async function recordPunRequest(name: string): Promise<void> {
  const trimmed = name.trim();
  if (isSupabaseConfigured()) {
    const supabase = getSupabase()!;
    const { error } = await supabase.from("pun_requests").insert({ name: trimmed });
    if (error) {
      // eslint-disable-next-line no-console
      console.error("Supabase insert (pun_requests) failed:", error.message);
      throw new Error("Failed to record your request. Try again in a moment.");
    }
    return;
  }

  await appendJSONLine("pun_requests.jsonl", {
    name: trimmed,
    receivedAt: new Date().toISOString(),
  });
}

export async function recordWaitlistEmail(
  email: string
): Promise<{ ok: boolean; alreadyExists?: boolean }> {
  if (isSupabaseConfigured()) {
    const supabase = getSupabase()!;
    const { error } = await supabase.from("waitlist").insert({ email });
    if (error) {
      // Postgres unique_violation — treat as a success, they're already on the list.
      if (error.code === "23505") {
        return { ok: true, alreadyExists: true };
      }
      // eslint-disable-next-line no-console
      console.error("Supabase insert (waitlist) failed:", error.message);
      return { ok: false };
    }
    return { ok: true };
  }

  await appendJSONLine("waitlist.jsonl", {
    email,
    receivedAt: new Date().toISOString(),
  });
  return { ok: true };
}
