import { NextRequest, NextResponse } from "next/server";
import { callLLMForJSON, LLMError } from "@/lib/llm";
import { FACTS_JSON_SCHEMA, FACTS_SYSTEM_PROMPT, buildFactsExtractionPrompt } from "@/lib/prompts";
import { FactsRequestBody, FactsResponse } from "@/lib/types";

const MAX_CHARS = 6000;

export async function POST(req: NextRequest) {
  let body: FactsRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const bio = body.bio ?? "";
  const conversationText = body.conversationText ?? "";

  if (!bio.trim() && !conversationText.trim()) {
    return NextResponse.json(
      { error: "Nothing to extract facts from yet." },
      { status: 400 }
    );
  }
  if (bio.length + conversationText.length > MAX_CHARS) {
    return NextResponse.json({ error: "Input too long." }, { status: 400 });
  }

  try {
    const result = await callLLMForJSON<FactsResponse>({
      systemPrompt: FACTS_SYSTEM_PROMPT,
      userPrompt: buildFactsExtractionPrompt({
        bio,
        conversationText,
        previousFacts: body.previousFacts,
      }),
      schema: FACTS_JSON_SCHEMA,
      temperature: 0.3,
      maxTokens: 700,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof LLMError ? err.message : "Unexpected error.";
    // eslint-disable-next-line no-console
    console.error("facts route error:", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
