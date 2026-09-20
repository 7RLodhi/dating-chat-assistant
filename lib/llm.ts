export class LLMError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "LLMError";
  }
}

type Provider = "openai" | "anthropic";

function resolveProvider(): Provider {
  const explicit = process.env.LLM_PROVIDER?.toLowerCase();
  if (explicit === "openai" || explicit === "anthropic") return explicit;
  // No explicit choice: if only an Anthropic key is present, use it.
  // Otherwise default to OpenAI (or any OPENAI_BASE_URL-compatible provider).
  if (process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    return "anthropic";
  }
  return "openai";
}

/** Returns "provider/model" for the currently configured provider — used for logging, not for the API call itself. */
export function describeModel(): string {
  const provider = resolveProvider();
  const model =
    provider === "anthropic"
      ? process.env.ANTHROPIC_MODEL || "claude-haiku-4-5"
      : process.env.OPENAI_MODEL || "gpt-4o-mini";
  return `${provider}/${model}`;
}

/**
 * Calls the configured LLM provider and returns parsed JSON matching the
 * caller's expected shape. `schema` is required for the Anthropic path
 * (used for tool-call-based structured output) and ignored by the OpenAI
 * path, which relies on json_object mode plus the schema described in the
 * prompt text (see lib/prompts.ts).
 */
export async function callLLMForJSON<T>(params: {
  systemPrompt: string;
  userPrompt: string;
  schema: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
}): Promise<T> {
  const provider = resolveProvider();
  return provider === "anthropic"
    ? callAnthropicForJSON<T>(params)
    : callOpenAIForJSON<T>(params);
}

// ---------------------------------------------------------------------------
// OpenAI (and OpenAI-compatible endpoints, e.g. OpenRouter)
// ---------------------------------------------------------------------------

// Defaults to OpenAI, but any OpenAI-compatible chat completions endpoint
// works (e.g. OpenRouter, which offers free-tier models — handy for testing
// this app without an OpenAI billing account). Override via OPENAI_BASE_URL
// and set OPENAI_API_KEY to that provider's key instead.
const OPENAI_URL =
  process.env.OPENAI_BASE_URL || "https://api.openai.com/v1/chat/completions";

async function callOpenAIForJSON<T>(params: {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<T> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new LLMError(
      "OPENAI_API_KEY is not set. Add it to .env.local before calling the suggestion API (or set ANTHROPIC_API_KEY to use Claude instead)."
    );
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const { systemPrompt, userPrompt, temperature = 0.9, maxTokens = 700 } = params;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const raw = await requestOpenAICompletion(apiKey, model, messages, temperature, maxTokens);
  const parsed = tryParseJSON<T>(raw);
  if (parsed) return parsed;

  // One corrective retry if the model didn't return valid JSON.
  const retryMessages = [
    ...messages,
    { role: "assistant", content: raw },
    {
      role: "user",
      content:
        "Your last response was not valid JSON. Return ONLY valid JSON matching the schema, with no extra text.",
    },
  ];
  const retryRaw = await requestOpenAICompletion(
    apiKey,
    model,
    retryMessages,
    temperature,
    maxTokens
  );
  const retryParsed = tryParseJSON<T>(retryRaw);
  if (retryParsed) return retryParsed;

  throw new LLMError("Model did not return valid JSON after retry.");
}

async function requestOpenAICompletion(
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[],
  temperature: number,
  maxTokens: number
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new LLMError(`LLM request failed (${res.status}): ${errBody}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new LLMError("LLM response missing message content.");
    }
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Anthropic (Claude)
// ---------------------------------------------------------------------------

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_TOOL_NAME = "return_suggestions";

async function callAnthropicForJSON<T>(params: {
  systemPrompt: string;
  userPrompt: string;
  schema: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
}): Promise<T> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new LLMError(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local before calling the suggestion API."
    );
  }

  // Undated aliases (e.g. "claude-haiku-4-5") track Anthropic's current
  // release within that model family, so this keeps working as versions
  // ship/retire without code changes. Check platform.claude.com/docs for the
  // current lineup if this ever 404s — Anthropic retires older model IDs on
  // a rolling basis. Override with a dated model ID via ANTHROPIC_MODEL if
  // you want a pinned, reproducible version instead.
  const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";
  const { systemPrompt, userPrompt, schema, temperature = 0.9, maxTokens = 700 } = params;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        // Forcing a tool call with an explicit input_schema is Anthropic's
        // equivalent of OpenAI's json_object/json_schema modes — it's the
        // reliable way to get back structured JSON instead of parsing free
        // text.
        tools: [
          {
            name: ANTHROPIC_TOOL_NAME,
            description: "Return the suggestions in the required structured format.",
            input_schema: schema,
          },
        ],
        tool_choice: { type: "tool", name: ANTHROPIC_TOOL_NAME },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new LLMError(`LLM request failed (${res.status}): ${errBody}`);
    }

    const data = await res.json();
    const toolUseBlock = (data?.content as Array<Record<string, unknown>> | undefined)?.find(
      (block) => block.type === "tool_use"
    );

    if (!toolUseBlock || typeof toolUseBlock.input !== "object") {
      throw new LLMError("Anthropic response did not include the expected tool call.");
    }

    return toolUseBlock.input as T;
  } finally {
    clearTimeout(timeout);
  }
}

function tryParseJSON<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Vision (screenshot transcription)
// ---------------------------------------------------------------------------

const CONVERSATION_TRANSCRIBE_INSTRUCTION = `This image is a screenshot of a dating app conversation. Transcribe it into plain text, one message per line, labeling each line [USER] or [MATCH] based on which side of the chat it's on (the app's own user is almost always the right-aligned / colored bubbles; the match is the left-aligned / gray bubbles — but use your best judgment if a specific app's layout differs).

Rules:
- Preserve message order top to bottom.
- Ignore UI chrome: timestamps, status bar, "typing...", read receipts, keyboard, buttons.
- If a message is split across multiple bubbles, keep them as separate lines.
- If you can't confidently read a word, make your best guess rather than omitting it.
- Output ONLY the transcribed lines in the format "[USER]: ..." or "[MATCH]: ...", nothing else — no commentary, no headers.`;

const PROFILE_TRANSCRIBE_INSTRUCTION = `This image is a screenshot of a dating app profile (bio, prompts/answers, or similar). Transcribe the readable text content: bio text, prompt questions and their answers, and any captions. If a photo has no readable text, briefly describe it in one short line prefixed with "[photo]:" (e.g. "[photo]: hiking on a mountain trail").

Rules:
- Preserve the order things appear top to bottom.
- Ignore UI chrome: app buttons (like/pass icons), navigation bars, percentages, distance/age badges.
- If you can't confidently read a word, make your best guess rather than omitting it.
- Output ONLY the transcribed content, nothing else — no commentary, no headers.`;

/**
 * Transcribes a screenshot into plain text using whichever provider/model is
 * already configured for suggestions — no separate OCR vendor or API key
 * needed, since current chat models are multimodal. If the configured model
 * doesn't support images, this call will fail with a clear error surfaced
 * from the provider. `kind` selects conversation-style ([USER]/[MATCH]
 * labeled) vs. profile-style (bio/prompts) transcription instructions.
 */
export async function transcribeImageToText(params: {
  imageBase64: string;
  mimeType: string;
  kind?: "conversation" | "profile";
}): Promise<string> {
  const provider = resolveProvider();
  const instruction =
    params.kind === "profile" ? PROFILE_TRANSCRIBE_INSTRUCTION : CONVERSATION_TRANSCRIBE_INSTRUCTION;
  return provider === "anthropic"
    ? transcribeWithAnthropic(params, instruction)
    : transcribeWithOpenAI(params, instruction);
}

async function transcribeWithOpenAI(
  params: { imageBase64: string; mimeType: string },
  instruction: string
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new LLMError("OPENAI_API_KEY is not set. Add it to .env.local to use screenshot upload.");
  }
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const { imageBase64, mimeType } = params;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: instruction },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new LLMError(`Screenshot transcription failed (${res.status}): ${errBody}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new LLMError("Transcription response missing message content.");
    }
    return content.trim();
  } finally {
    clearTimeout(timeout);
  }
}

async function transcribeWithAnthropic(
  params: { imageBase64: string; mimeType: string },
  instruction: string
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new LLMError("ANTHROPIC_API_KEY is not set. Add it to .env.local to use screenshot upload.");
  }
  const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";
  const { imageBase64, mimeType } = params;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: 1000,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mimeType, data: imageBase64 },
              },
              { type: "text", text: instruction },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new LLMError(`Screenshot transcription failed (${res.status}): ${errBody}`);
    }

    const data = await res.json();
    const textBlocks = (data?.content as Array<Record<string, unknown>> | undefined)?.filter(
      (block) => block.type === "text"
    );
    const text = textBlocks?.map((b) => b.text as string).join("\n").trim();
    if (!text) {
      throw new LLMError("Transcription response missing text content.");
    }
    return text;
  } finally {
    clearTimeout(timeout);
  }
}
