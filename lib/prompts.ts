import { Goal, Language, Tone } from "./types";

export const TONE_DESCRIPTIONS: Record<Tone, string> = {
  playful: "Lighthearted, teasing, a little silly. Uses humor. Low stakes.",
  sincere:
    "Genuine, warm, a bit more vulnerable. Shows real interest without irony.",
  witty:
    "Clever wordplay or a sharp observational joke. Should feel effortless, not try-hard.",
  bold: "Direct and confident. States interest or intent plainly, without being aggressive or presumptuous.",
  low_effort:
    "Short, casual, low-pressure. For when the user just wants to keep things moving without overthinking it.",
};

export const GOAL_DESCRIPTIONS: Record<Goal, string> = {
  get_a_reply:
    "Primary aim is to re-engage someone who has gone quiet or give them an easy, appealing thing to respond to.",
  escalate_to_date:
    "Primary aim is to naturally move the conversation toward suggesting meeting up, without being pushy.",
  keep_it_light:
    "Primary aim is to keep an already-good conversation flowing casually, no pressure to escalate.",
};

export const TONE_OPTIONS: { value: Tone; label: string }[] = [
  { value: "playful", label: "Playful" },
  { value: "sincere", label: "Sincere" },
  { value: "witty", label: "Witty" },
  { value: "bold", label: "Bold" },
  { value: "low_effort", label: "Low effort" },
];

export const GOAL_OPTIONS: { value: Goal; label: string }[] = [
  { value: "get_a_reply", label: "Get a reply" },
  { value: "escalate_to_date", label: "Suggest meeting up" },
  { value: "keep_it_light", label: "Keep it light" },
];

export const LANGUAGE_DESCRIPTIONS: Record<Language, string> = {
  auto: "Detect the language/script the match is actually writing in from the conversation, and reply in that same language and script. If there isn't enough signal (e.g. no messages yet, or it's genuinely ambiguous), default to English.",
  english: "Reply in English only.",
  hindi: "Reply in Hindi, written in Devanagari script (e.g. \"अरे वाह, ये तो बहुत बढ़िया है\").",
  hinglish:
    "Reply in Hinglish: casual, code-mixed Hindi-English written in Roman/Latin script, the way most young urban Indians actually text on dating apps (e.g. \"arre yaar that's so cute\", \"kya kar rahe ho abhi\").",
};

export const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: "auto", label: "Auto-detect" },
  { value: "english", label: "English" },
  { value: "hinglish", label: "Hinglish" },
  { value: "hindi", label: "Hindi" },
];

export const SYSTEM_PROMPT = `You are a texting assistant that helps someone respond well in a dating app conversation. You suggest short, natural-sounding messages the user could send — you do not send anything yourself.

Rules:
- Write in the voice of the USER (the person asking you), replying TO their match. Never write as the match.
- Suggestions must sound like a real person casually texting, not a copywriter. No poetry, no emojis unless the conversation's existing tone uses them, no exclamation-point overload.
- Match the energy and effort level already present in the conversation unless the user's selected tone explicitly asks for a shift.
- Each suggestion must be understandable with zero extra context — no placeholders like "[her name]" or "[insert detail]".
- Do not generate anything sexually explicit, degrading, manipulative (e.g., negging, guilt-tripping, love-bombing), dishonest (fake shared interests, fake compliments about appearance you have no evidence for), or that pressures the match for personal info, meetups, or contact details when the conversation shows disinterest.
- If the conversation shows signs of disengagement or discomfort from the match (short/cold replies, delayed responses implied, declining an ask), prioritize suggestions that gracefully lower pressure, not suggestions that escalate.
- Never invent facts about the match that are not present in the given context (e.g., do not assume a job, location, or interest that wasn't stated).
- Keep each suggestion under 40 words.
- If a "USER'S WRITING STYLE" reference is provided, match that voice — capitalization habits (e.g. all lowercase), punctuation (or lack of it), typical message length, emoji/slang habits, and recurring phrasing quirks — while still following the selected tone and goal for content and angle. The style reference governs *how* they write; tone/goal govern *what* they say.
- Follow the LANGUAGE instruction for which language/script to write the suggestions in. Write naturally and idiomatically in that language — never a stiff, word-for-word translation of an English sentence. For Hinglish specifically, code-mix the way real speakers do (mixing Hindi and English words/grammar in one sentence), not just English with a few Hindi words sprinkled in, and not full Hindi either.
- Output must be valid JSON matching the provided schema. No text outside the JSON.`;

export function buildReplyUserPrompt(params: {
  conversationText: string;
  tone: Tone;
  goal: Goal;
  extraContext?: string;
  styleExamples?: string;
  language?: Language;
}): string {
  const { conversationText, tone, goal, extraContext, styleExamples, language = "auto" } = params;
  return `Generate reply suggestions for an ongoing dating app conversation.

CONVERSATION (most recent messages last; [USER] is the person asking for help, [MATCH] is the other person):
"""
${conversationText}
"""

DESIRED TONE: ${tone} — ${TONE_DESCRIPTIONS[tone]}
GOAL: ${goal} — ${GOAL_DESCRIPTIONS[goal]}
LANGUAGE: ${language} — ${LANGUAGE_DESCRIPTIONS[language]}
${buildStyleSection(styleExamples)}
Additional context from user (optional, may be empty): "${extraContext ?? ""}"

Generate 5 distinct reply options that [USER] could send next. Vary the approach (e.g., a question, a playful callback, a direct statement, a joke) — do not make all 5 minor rewordings of each other. At least one should be a question that invites a real answer (not yes/no) where appropriate.

Return JSON matching this schema:
{
  "conversation_read": {
    "mood_label": "string, one of: high_interest | playful | neutral | cooling_off | disengaged | mixed_signals",
    "confidence": "number 0-1",
    "summary": "string, one sentence explaining the read, plain language, suitable to show to the end user"
  },
  "suggestions": [
    {
      "text": "string, the actual message to send",
      "tone": "string, one of the tone labels",
      "approach": "string, 2-5 words describing the angle",
      "rationale": "string, one sentence, internal use only, not shown to end user"
    }
  ]
}`;
}

export function buildOpenerUserPrompt(params: {
  profileText: string;
  tone: Tone;
  goal: Goal;
  styleExamples?: string;
  language?: Language;
}): string {
  const { profileText, tone, goal, styleExamples, language = "auto" } = params;
  const openerLanguageNote =
    language === "auto"
      ? `${LANGUAGE_DESCRIPTIONS.auto} There's no conversation yet, so only the profile info below can give a signal (e.g. a bio written in Hindi/Hinglish) — otherwise default to English.`
      : LANGUAGE_DESCRIPTIONS[language];
  return `Generate opening message suggestions for a dating app match.

MATCH'S PROFILE INFO (as provided by the user; may be partial or empty):
"""
${profileText}
"""
(This may include bio text, prompts/answers, or the user's own description of photos. If empty or sparse, generate suggestions based on general engaging openers that don't require specific details, and note this in "rationale".)

DESIRED TONE: ${tone} — ${TONE_DESCRIPTIONS[tone]}
GOAL: ${goal} — ${GOAL_DESCRIPTIONS[goal]}
LANGUAGE: ${language} — ${openerLanguageNote}
${buildStyleSection(styleExamples)}
Generate 5 distinct opening message options. Vary the approach across the 5 (don't make them all near-duplicates of each other). At least one should directly reference something specific from the profile info if any was given.

Return JSON matching this schema:
{
  "suggestions": [
    {
      "text": "string, the actual message to send",
      "tone": "string, one of the tone labels",
      "approach": "string, 2-5 words describing the angle (e.g., 'callback to travel photo', 'playful challenge', 'direct compliment')",
      "rationale": "string, one sentence, internal use only, not shown to end user"
    }
  ]
}`;
}

function buildStyleSection(styleExamples?: string): string {
  if (!styleExamples || !styleExamples.trim()) return "";
  return `
USER'S WRITING STYLE (real messages they've actually sent):
"""
${styleExamples}
"""
Use these ONLY to infer patterns — capitalization, punctuation, typical message length, emoji/slang habits — and apply those patterns to new, contextually relevant content. Do NOT copy phrases or sentences from these examples verbatim; they are a voice reference, not source material. This governs HOW the user writes; tone/goal above govern WHAT they say.
`;
}

// ---------------------------------------------------------------------------
// Style analysis (optional "what we noticed about your style" feature)
// ---------------------------------------------------------------------------

export const STYLE_SYSTEM_PROMPT = `You analyze a sample of someone's real text messages and describe their texting voice in plain, specific language. You are not judging quality — just describing observable patterns so another writer could imitate the voice convincingly. Be concrete (cite patterns like "lowercase, no ending punctuation" or "uses 'lol' as a soft transition") rather than vague ("casual and friendly").`;

export function buildStyleAnalysisPrompt(sampleMessages: string): string {
  return `Here are examples of messages someone has actually sent (their own texts, not messages they received):
"""
${sampleMessages}
"""

Describe their texting voice: capitalization habits, punctuation habits, typical message length, emoji/slang usage, and any recurring phrases or quirks.

Return JSON matching this schema:
{
  "summary": "string, 2-3 sentences describing their overall voice, written so it can be shown directly to the user",
  "traits": ["string", "string", "... 3-6 short concrete bullet points, e.g. 'lowercase, minimal punctuation', 'often ends with a question', 'uses \\"haha\\" more than emoji'"]
}`;
}

export const STYLE_JSON_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    traits: {
      type: "array",
      minItems: 3,
      maxItems: 6,
      items: { type: "string" },
    },
  },
  required: ["summary", "traits"],
};

// JSON Schemas used for Anthropic's tool-call-based structured output (see
// lib/llm.ts). The OpenAI path relies on json_object mode plus the schema
// described in the prompt text above, so these aren't needed there — but
// keeping one schema definition per mode means both providers are guaranteed
// to return the same shape.

const SUGGESTION_ITEM_SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string" },
    tone: { type: "string" },
    approach: { type: "string" },
    rationale: { type: "string" },
  },
  required: ["text", "tone", "approach", "rationale"],
};

export const REPLY_JSON_SCHEMA = {
  type: "object",
  properties: {
    conversation_read: {
      type: "object",
      properties: {
        mood_label: {
          type: "string",
          enum: [
            "high_interest",
            "playful",
            "neutral",
            "cooling_off",
            "disengaged",
            "mixed_signals",
          ],
        },
        confidence: { type: "number" },
        summary: { type: "string" },
      },
      required: ["mood_label", "confidence", "summary"],
    },
    suggestions: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: SUGGESTION_ITEM_SCHEMA,
    },
  },
  required: ["conversation_read", "suggestions"],
};

export const OPENER_JSON_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: SUGGESTION_ITEM_SCHEMA,
    },
  },
  required: ["suggestions"],
};
