export class LLMError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "LLMError";
  }
}

type Provider = "openai" | "anthropic";

/**
 * Model tier: "standard" is the cheap default (Haiku / gpt-4o-mini) used
 * for everything; "premium" (Sonnet / gpt-4o) is reserved for calls where
 * writing quality IS the product — spicy suggestions and fantasy scenarios.
 * Callers opt in per call (see suggest/fantasy routes); nothing defaults
 * to premium, so costs only rise on those two paths.
 */
export type ModelTier = "standard" | "premium";

function resolveModel(provider: Provider, tier: ModelTier): string {
  if (provider === "anthropic") {
    // Rolled back from Sonnet 5.5: it answered fantasy requests in English
    // despite language=hinglish (verified live). Back on the dated 4.5 ID
    // until 5.x language compliance is proven. Override freely.
    return tier === "premium"
      ? process.env.ANTHROPIC_PREMIUM_MODEL || "claude-sonnet-4-5-20250929"
      : process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
  }
  return tier === "premium"
    ? process.env.OPENAI_PREMIUM_MODEL || "gpt-4o"
    : process.env.OPENAI_MODEL || "gpt-4o-mini";
}

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
export function describeModel(tier: ModelTier = "standard"): string {
  const provider = resolveProvider();
  return `${provider}/${resolveModel(provider, tier)}`;
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
  tier?: ModelTier;
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
  tier?: ModelTier;
}): Promise<T> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new LLMError(
      "OPENAI_API_KEY is not set. Add it to .env.local before calling the suggestion API (or set ANTHROPIC_API_KEY to use Claude instead)."
    );
  }

  const model = resolveModel("openai", params.tier ?? "standard");
  const { systemPrompt, userPrompt, temperature = 0.9, maxTokens = 700 } = params;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const raw = await requestOpenAICompletion(apiKey, model, messages, temperature, maxTokens, params.tier ?? "standard");
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
    maxTokens,
    params.tier ?? "standard"
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
  maxTokens: number,
  tier: ModelTier = "standard"
): Promise<string> {
  const controller = new AbortController();
  // Premium models think longer — give them room. Standard keeps the tight
  // 15s budget so a hung request fails fast instead of burning the whole
  // route timeout (maxDuration) on one call.
  const timeout = setTimeout(
    () => controller.abort(),
    tier === "premium" ? 50000 : 15000
  );

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
  } catch (err) {
    // fetch abort surfaces as a DOM AbortError, not an LLMError — without
    // this mapping the route returns a useless "Unexpected error." 502.
    if (err instanceof Error && err.name === "AbortError") {
      throw new LLMError("LLM request timed out — the model took too long to respond.");
    }
    throw err;
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
  tier?: ModelTier;
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
  // a rolling basis. Override with a dated model ID via ANTHROPIC_MODEL (or
  // ANTHROPIC_PREMIUM_MODEL for the premium tier) if you want a pinned,
  // reproducible version instead.
  const model = resolveModel("anthropic", params.tier ?? "standard");
  const { systemPrompt, userPrompt, schema, temperature = 0.9, maxTokens: maxTokensParam } = params;

  const controller = new AbortController();
  // Standard was 15s: Haiku 5.5 routinely needs 15-20s for a full batch, so
  // it hit the cap on ~1 in 4 requests. 30s keeps a hard ceiling under the
  // route's 60s maxDuration even with one corrective retry.
  const timeout = setTimeout(
    () => controller.abort(),
    (params.tier ?? "standard") === "premium" ? 50000 : 30000
  );

  // The 5.x family rejects forced tool choice (400: tool_choice "tool"/"any"
  // not supported for the model), so all Anthropic calls use "auto" 4.x and
  // text-JSON 5.x, both with parse + corrective-retry fallback — the same
  // shape the OpenAI path already relies on.
  // The 5.x family deprecated `temperature` (400 if sent) — omit it there,
  // keep it everywhere else. Major version is parsed from the model ID
  // (claude-<family>-<major>…); unparseable IDs assume support.
  const majorVersion = (() => {
    const m = model.match(/claude-[a-z]+-(\d+)/i);
    return m ? parseInt(m[1], 10) : null;
  })();
  const modernModel = (majorVersion ?? 4) >= 5;
  // 5.x also rejects forced tool choice AND fumbles complex tool schemas
  // (observed: malformed tool input + empty parallel tool call, burning the
  // whole token budget). So 5.x gets pure text-JSON mode — the prompt
  // already carries the full "return JSON matching this schema" text for
  // the OpenAI path — with the same parse + corrective-retry safety net.
  // 4.x keeps tool calls (auto choice + text fallback covers both).
  const toolsPart = modernModel
    ? {}
    : {
        tools: [
          {
            name: ANTHROPIC_TOOL_NAME,
            description: "Return the suggestions in the required structured format.",
            input_schema: schema,
          },
        ],
        tool_choice: { type: "auto" },
      };
  // 5.x runs wordier: give it headroom so a full reply batch isn't cut off
  // mid-JSON (observed stop_reason=max_tokens at 700 on the first attempt).
  const effectiveMaxTokens = maxTokensParam ?? (modernModel ? 1500 : 700);
  const body: Record<string, unknown> = {
    model,
    max_tokens: effectiveMaxTokens,
    ...(majorVersion === null || majorVersion < 5 ? { temperature } : {}),
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    ...toolsPart,
  };

  try {
    const first = await requestAnthropic(body, apiKey, controller.signal);
    const parsed = extractAnthropicJSON<T>(first);
    if (parsed) return parsed;

    const retryBody: Record<string, unknown> = {
      ...body,
      messages: [
        { role: "user", content: userPrompt },
        { role: "assistant", content: first.text === "" ? "(empty response)" : first.text },
        {
          role: "user",
          content: "That was not valid JSON. Return ONLY valid JSON matching the schema, with no extra text.",
        },
      ],
    };
    const retryParsed = extractAnthropicJSON<T>(
      await requestAnthropic(retryBody, apiKey, controller.signal)
    );
    if (retryParsed) return retryParsed;

    throw new LLMError("Model did not return valid JSON after retry.");
  } catch (err) {
    // See the OpenAI path above: map aborts to a meaningful LLMError.
    if (err instanceof Error && err.name === "AbortError") {
      throw new LLMError("LLM request timed out — the model took too long to respond.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/** One raw message send; returns tool input (if the model called the tool) plus concatenated text. */
async function requestAnthropic(
  body: Record<string, unknown>,
  apiKey: string,
  signal: AbortSignal
): Promise<{ toolInput: unknown; text: string }> {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new LLMError(`LLM request failed (${res.status}): ${errBody}`);
  }

  const data = await res.json();
  const blocks = (data?.content as Array<Record<string, unknown>> | undefined) ?? [];
  const toolUseBlock = blocks.find((block) => block.type === "tool_use");
  const text = blocks
    .filter((block) => block.type === "text")
    .map((block) => String(block.text ?? ""))
    .join("\n")
    .trim();
  return {
    toolInput: toolUseBlock ? (toolUseBlock as { input?: unknown }).input : undefined,
    text,
  };
}

/** Prefer a tool call; fall back to parsing JSON text (fences stripped). */
function extractAnthropicJSON<T>(r: { toolInput: unknown; text: string }): T | null {
  if (r.toolInput && typeof r.toolInput === "object") return r.toolInput as T;
  const fenced = r.text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return tryParseJSON<T>((fenced ? fenced[1] : r.text).trim());
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
- Skip standalone sender labels: small name tags like "ME" or a display name sitting alone above a message bubble are app chrome, not messages — never transcribe them as lines.
- If a message is split across multiple bubbles, keep them as separate lines.
- Quoted replies: if a bubble contains a quoted/replied-to message (usually smaller or dimmer text above the main message, sometimes with a reply indicator or vertical bar), split it into its own line. In a 1:1 chat the quote is virtually always the OTHER person's words, so label it with the opposite speaker of the enclosing bubble and prefix it with "(quoted) ". Example: your right-side bubble quoting the match becomes two lines: "[MATCH]: (quoted) original words here" followed by "[USER]: your reply here".
- If you can't confidently read a word, make your best guess rather than omitting it.
- Transcribe in whatever language/script the messages are actually written in (English, Hindi/Devanagari, Hinglish in Roman script, etc.) — do NOT translate.
- Output ONLY the transcribed lines in the format "[USER]: ..." or "[MATCH]: ...", nothing else — no commentary, no headers.`;

const PROFILE_TRANSCRIBE_INSTRUCTION = `This image is a screenshot of a dating app profile (bio, prompts/answers, or similar). Transcribe the readable text content: bio text, prompt questions and their answers, and any captions. If a photo has no readable text, briefly describe it in one short line prefixed with "[photo]:" (e.g. "[photo]: hiking on a mountain trail").

Rules:
- Preserve the order things appear top to bottom.
- Ignore UI chrome: app buttons (like/pass icons), navigation bars, percentages, distance/age badges.
- If you can't confidently read a word, make your best guess rather than omitting it.
- Transcribe in whatever language/script the text is actually written in — do NOT translate.
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
  const model = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
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
