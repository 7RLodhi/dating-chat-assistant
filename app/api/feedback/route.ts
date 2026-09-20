import { NextRequest, NextResponse } from "next/server";
import { recordFeedback } from "@/lib/store";
import { FeedbackRequestBody } from "@/lib/types";

export async function POST(req: NextRequest) {
  let body: FeedbackRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.suggestionText || (body.vote !== "up" && body.vote !== "down")) {
    return NextResponse.json({ error: "Invalid feedback payload." }, { status: 400 });
  }

  await recordFeedback({
    generationId: body.generationId,
    suggestionText: body.suggestionText,
    tone: body.tone,
    approach: body.approach,
    vote: body.vote,
  });

  return NextResponse.json({ ok: true });
}
