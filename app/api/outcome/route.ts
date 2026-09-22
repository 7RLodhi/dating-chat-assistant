import { NextRequest, NextResponse } from "next/server";
import { recordOutcome } from "@/lib/store";
import { OutcomeRequestBody } from "@/lib/types";

export async function POST(req: NextRequest) {
  let body: OutcomeRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.suggestionText || typeof body.replied !== "boolean") {
    return NextResponse.json({ error: "Invalid outcome payload." }, { status: 400 });
  }

  await recordOutcome({
    generationId: body.generationId,
    matchName: body.matchName,
    suggestionText: body.suggestionText,
    replied: body.replied,
  });

  return NextResponse.json({ ok: true });
}
