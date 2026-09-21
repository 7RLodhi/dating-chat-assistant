import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { callLLMForJSON, describeModel, LLMError } from "@/lib/llm";
import {
  OPENER_JSON_SCHEMA,
  REPLY_JSON_SCHEMA,
  SYSTEM_PROMPT,
  buildOpenerUserPrompt,
  buildReplyUserPrompt,
} from "@/lib/prompts";
import { recordGeneration } from "@/lib/store";
import { Goal, Language, SuggestRequestBody, SuggestResponse, Tone } from "@/lib/types";

const VALID_TONES: Tone[] = ["playful", "sincere", "witty", "bold", "low_effort"];
const VALID_GOALS: Goal[] = ["get_a_reply", "escalate_to_date", "keep_it_light"];
const VALID_LANGUAGES: Language[] = ["auto", "english", "hindi", "hinglish"];
const MAX_INPUT_CHARS = 4000;

export async function POST(req: NextRequest) {
  let body: SuggestRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { mode, tone, goal, extraContext, styleExamples, viaScreenshot } = body;
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

  const textField = mode === "reply" ? body.conversationText : body.profileText;
  if (!textField || !textField.trim()) {
    return NextResponse.json(
      {
        error:
          mode === "reply"
            ? "conversationText is required for mode 'reply'."
            : "profileText is required for mode 'opener' (can be a short description if no bio text is available).",
      },
      { status: 400 }
    );
  }
  if (textField.length > MAX_INPUT_CHARS) {
    return NextResponse.json(
      { error: `Input text too long (max ${MAX_INPUT_CHARS} characters).` },
      { status: 400 }
    );
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
        })
      : buildOpenerUserPrompt({ profileText: textField, tone, goal, styleExamples, language });

  try {
    const result = await callLLMForJSON<SuggestResponse>({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      schema: mode === "reply" ? REPLY_JSON_SCHEMA : OPENER_JSON_SCHEMA,
    });

    if (!Array.isArray(result.suggestions) || result.suggestions.length === 0) {
      return NextResponse.json(
        { error: "Model returned no suggestions." },
        { status: 502 }
      );
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
