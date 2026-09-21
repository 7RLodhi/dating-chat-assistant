import { NextRequest, NextResponse } from "next/server";
import { voteNamePun } from "@/lib/store";
import { VotePunRequestBody } from "@/lib/types";

export async function POST(req: NextRequest) {
  let body: VotePunRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.id || (body.vote !== "worked" && body.vote !== "notWorked")) {
    return NextResponse.json({ error: "Invalid vote payload." }, { status: 400 });
  }

  try {
    const updated = await voteNamePun(body.id, body.vote);
    if (!updated) {
      return NextResponse.json({ error: "Pun not found." }, { status: 404 });
    }
    return NextResponse.json({ pun: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error.";
    // eslint-disable-next-line no-console
    console.error("puns vote error:", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
