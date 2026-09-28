import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { callLLMForJSON, describeModel, LLMError } from "@/lib/llm";
import {
  NAME_PUN_JSON_SCHEMA,
  OPENER_JSON_SCHEMA,
  NAME_PUN_SYSTEM_PROMPT,
  REPLY_JSON_SCHEMA,
  SYSTEM_PROMPT,
  buildGenderCorrection,
  buildNamePunPrompt,
  buildOpenerUserPrompt,
  buildRegisterCorrection,
  buildReplyUserPrompt,
  buildVerbCorrection,
  detectHindiRegister,
  violatesGender,
  violatesRegister,
  violatesVerbForm,
} from "@/lib/prompts";
import { getTopPunForName, recordGeneration } from "@/lib/store";
import { Goal, Language, SuggestRequestBody, SuggestResponse, Tone } from "@/lib/types";

const VALID_TONES: Tone[] = ["casual", "playful", "witty", "sincere", "flirty", "spicy", "auto"];
// Labels a suggestion may carry (auto is a request mode, never a label).
const DISPLAY_TONES = ["casual", "playful", "witty", "sincere", "flirty", "spicy"] as const;
const VALID_GOALS: Goal[] = ["get_a_reply", "escalate_to_date", "keep_it_light"];
const VALID_LANGUAGES: Language[] = ["auto", "english", "hindi", "hinglish"];
const MAX_INPUT_CHARS = 4000;

// Suggestion calls routinely take 8-12s and ~2x that when a grammar-retry
// pass runs — give the function room instead of letting the platform kill
// slow-but-healthy requests with a bare 502.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: SuggestRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { mode, tone, goal, extraContext, styleExamples, viaScreenshot, matchName, tasteProfile } = body;
  const userGender =
    body.userGender === "male" || body.userGender === "female" ? body.userGender : undefined;
  const language: Language = body.language ?? "auto";

  if (mode !== "reply" && mode !== "opener") {
    return NextResponse.json(
      { error: "mode must be 'reply' or 'opener'." },
      { status: 400 }
    );
  }
  if (!VALID_TONES.includes(tone)) {
    return NextResponse.json({ error: "Invalid tone." }, { status: 400 });
  }
  if (!VALID_GOALS.includes(goal)) {
    return NextResponse.json({ error: "Invalid goal." }, { status: 400 });
  }
  if (!VALID_LANGUAGES.includes(language)) {
    return NextResponse.json({ error: "Invalid language." }, { status: 400 });
  }

  let textField = mode === "reply" ? body.conversationText : body.profileText;
  if (!textField || !textField.trim()) {
    // Empty-window openers (e.g. overlay with only your greeting captured):
    // synthesize context instead of failing, so clients always get opening
    // lines + name puns. The opener prompt already handles sparse profiles.
    if (mode === "opener") {
      textField = matchName?.trim()
        ? `(No bio provided — the only thing known is their name: ${matchName.trim()})`
        : "(No profile info provided — write general opening lines)";
    } else {
      return NextResponse.json(
        { error: "conversationText is required for mode 'reply'." },
        { status: 400 }
      );
    }
  }
  if (textField.length > MAX_INPUT_CHARS) {
    return NextResponse.json(
      { error: `Input text too long (max ${MAX_INPUT_CHARS} characters).` },
      { status: 400 }
    );
  }

  let namePunHint: string | undefined;
  if (mode === "opener" && matchName?.trim()) {
    // Prefer a community-voted pun from the directory; fall back to the LLM
    // check only when the directory has nothing for this name.
    try {
      const communityPun = await getTopPunForName(matchName.trim());
      if (communityPun) {
        namePunHint = communityPun.pun;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("directory pun lookup failed, falling back to LLM:", err);
    }
  }
  if (mode === "opener" && matchName?.trim() && !namePunHint) {
    try {
      const punResult = await callLLMForJSON<{ has_pun: boolean; pun_line: string }>({
        systemPrompt: NAME_PUN_SYSTEM_PROMPT,
        userPrompt: buildNamePunPrompt(matchName.trim()),
        schema: NAME_PUN_JSON_SCHEMA,
        temperature: 0.5,
        maxTokens: 150,
      });
      if (punResult.has_pun && punResult.pun_line?.trim()) {
        namePunHint = punResult.pun_line.trim();
      }
    } catch (err) {
      // Non-fatal — just proceed without a name pun.
      // eslint-disable-next-line no-console
      console.error("name pun check failed, continuing without it:", err);
    }
  }

  const userPrompt =
    mode === "reply"
      ? buildReplyUserPrompt({
          conversationText: textField,
          tone,
          goal,
          extraContext,
          styleExamples,
          language,
          tasteProfile,
          userGender,
        })
      : buildOpenerUserPrompt({ profileText: textField, tone, goal, styleExamples, language, namePunHint, tasteProfile, userGender });

  try {
    const schema = mode === "reply" ? REPLY_JSON_SCHEMA : OPENER_JSON_SCHEMA;
    let result = await callLLMForJSON<SuggestResponse>({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      schema,
    });

    // Hard guards for Hindi/Hinglish grammar (a prompt rule alone still
    // slips): drop suggestions with the wrong pronoun register, with
    // ungrammatical perfect+hoon verbs ("dekha hoon"), or with verb forms of
    // the wrong gender for the declared user ("me soch rhi hu" from a male
    // user mirroring his match); if fewer than 3 survive, retry once with
    // explicit corrections and keep the better of the two attempts.
    const needsHindiGuard = mode === "reply" && language !== "english";
    const register = needsHindiGuard ? detectHindiRegister(textField) : null;
    if (needsHindiGuard && Array.isArray(result.suggestions)) {
      const keep = (r: SuggestResponse) =>
        (r.suggestions ?? []).filter(
          (s) =>
            !violatesRegister(s.text, register) &&
            !violatesVerbForm(s.text) &&
            !violatesGender(s.text, userGender)
        );
      let kept = keep(result);
      if (kept.length < 3) {
        try {
          const retry = await callLLMForJSON<SuggestResponse>({
            systemPrompt: SYSTEM_PROMPT,
            userPrompt:
              userPrompt +
              (register ? buildRegisterCorrection(register) : "") +
              buildVerbCorrection() +
              (userGender ? buildGenderCorrection(userGender) : ""),
            schema,
          });
          const retryKept = keep(retry);
          if (retryKept.length > kept.length) {
            result = retry;
            kept = retryKept;
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("register retry failed, keeping first attempt:", err);
        }
      }
      // Never return an empty list over a grammar slip.
      if (kept.length > 0) result = { ...result, suggestions: kept };
    }

    if (!Array.isArray(result.suggestions) || result.suggestions.length === 0) {
      return NextResponse.json(
        { error: "Model returned no suggestions." },
        { status: 502 }
      );
    }

    // The model occasionally invents tone labels (e.g. "thoughtful"). Those
    // would render as bogus chips and pollute per-tone vote learning, so
    // snap anything unrecognized to the requested tone (casual for auto).
    const fallbackTone = tone === "auto" ? "casual" : tone;
    result.suggestions = result.suggestions.map((s) => ({
      ...s,
      tone:
        typeof s.tone === "string" && (DISPLAY_TONES as readonly string[]).includes(s.tone.toLowerCase())
          ? s.tone.toLowerCase()
          : fallbackTone,
    }));

    // The model sometimes emits the same line twice word-for-word. Drop
    // exact duplicates (case-insensitive, keep first) — a repeated
    // suggestion is never useful, whatever the tone.
    {
      const seen = new Set<string>();
      result.suggestions = result.suggestions.filter((s) => {
        const key = s.text.trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    const id = randomUUID();

    // Best-effort logging — never fail the user-facing request over it.
    // This is what makes the 👍/👎 feedback loop analyzable later (joins
    // feedback rows back to the tone/goal/mood that produced them).
    recordGeneration({
      id,
      mode,
      tone,
      goal,
      inputText: textField,
      extraContext,
      conversationRead: result.conversation_read,
      suggestions: result.suggestions,
      model: describeModel(),
      styleApplied: Boolean(styleExamples?.trim()),
      viaScreenshot: Boolean(viaScreenshot),
      language,
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("recordGeneration failed:", err);
    });

    return NextResponse.json({ ...result, id });
  } catch (err) {
    const message = err instanceof LLMError ? err.message : "Unexpected error.";
    // eslint-disable-next-line no-console
    console.error("suggest route error:", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
