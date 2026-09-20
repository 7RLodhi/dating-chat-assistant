import { NextRequest, NextResponse } from "next/server";
import { callLLMForJSON, LLMError } from "@/lib/llm";
import {
  STYLE_JSON_SCHEMA,
  STYLE_SYSTEM_PROMPT,
  buildStyleAnalysisPrompt,
} from "@/lib/prompts";
import { StyleAnalysis, StyleAnalyzeRequestBody } from "@/lib/types";

const MAX_SAMPLE_CHARS = 4000;

export async function POST(req: NextRequest) {
  let body: StyleAnalyzeRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const sampleMessages = body.sampleMessages?.trim();
  if (!sampleMessages) {
    return NextResponse.json(
      { error: "sampleMessages is required (paste a few messages you've sent before)." },
      { status: 400 }
    );
  }
  if (sampleMessages.length > MAX_SAMPLE_CHARS) {
    return NextResponse.json(
      { error: `Sample too long (max ${MAX_SAMPLE_CHARS} characters).` },
      { status: 400 }
    );
  }

  try {
    const result = await callLLMForJSON<StyleAnalysis>({
      systemPrompt: STYLE_SYSTEM_PROMPT,
      userPrompt: buildStyleAnalysisPrompt(sampleMessages),
      schema: STYLE_JSON_SCHEMA,
      temperature: 0.4,
      maxTokens: 400,
    });

    if (!result.summary || !Array.isArray(result.traits)) {
      return NextResponse.json(
        { error: "Model returned an unexpected shape." },
        { status: 502 }
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof LLMError ? err.message : "Unexpected error.";
    // eslint-disable-next-line no-console
    console.error("style route error:", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
