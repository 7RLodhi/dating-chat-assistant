import { NextRequest, NextResponse } from "next/server";
import { callLLMForJSON, LLMError } from "@/lib/llm";
import {
  FANTASY_JSON_SCHEMA,
  FANTASY_SYSTEM_PROMPT,
  buildFantasyPrompt,
} from "@/lib/prompts";
import { FantasyRequestBody, FantasyResponse } from "@/lib/types";

const VALID_LANGUAGES = ["hindi", "hinglish", "english"];
const DEFAULT_COUNT = 8;
const MAX_AVOID = 60;

export async function POST(req: NextRequest) {
  let body: FantasyRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const language = VALID_LANGUAGES.includes(body.language ?? "")
    ? (body.language as string)
    : "hindi";
  const count = Math.min(Math.max(body.count ?? DEFAULT_COUNT, 1), 10);
  const avoid = Array.isArray(body.avoid)
    ? body.avoid.filter((a) => typeof a === "string" && a.trim()).slice(0, MAX_AVOID)
    : [];

  try {
    const result = await callLLMForJSON<FantasyResponse>({
      systemPrompt: FANTASY_SYSTEM_PROMPT,
      userPrompt: buildFantasyPrompt({ language, count, avoid }),
      schema: FANTASY_JSON_SCHEMA,
      temperature: 0.9,
      maxTokens: 500,
    });

    if (!Array.isArray(result.items)) {
      return NextResponse.json(
        { error: "Model returned an unexpected shape." },
        { status: 502 }
      );
    }

    // Clean up: drop empties, dedupe (case-insensitive), and drop anything
    // echoing the avoid list — belt and suspenders around the prompt rule.
    const seen = new Set(avoid.map((a) => a.trim().toLowerCase()));
    const items: string[] = [];
    for (const raw of result.items) {
      if (typeof raw !== "string") continue;
      const text = raw.trim();
      const key = text.toLowerCase();
      if (!text || seen.has(key)) continue;
      seen.add(key);
      items.push(text);
    }

    if (items.length === 0) {
      return NextResponse.json(
        { error: "Couldn't come up with fresh ideas — try again." },
        { status: 502 }
      );
    }

    return NextResponse.json({ items });
  } catch (err) {
    const message = err instanceof LLMError ? err.message : "Unexpected error.";
    // eslint-disable-next-line no-console
    console.error("fantasy route error:", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
