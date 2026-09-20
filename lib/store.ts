import { appendJSONLine } from "./devStore";
import { getSupabase, isSupabaseConfigured } from "./supabase";
import { ConversationRead, Goal, Mode, Suggestion, Tone } from "./types";

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
