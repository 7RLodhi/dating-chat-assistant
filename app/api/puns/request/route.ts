import { NextRequest, NextResponse } from "next/server";
import { recordPunRequest } from "@/lib/store";
import { RequestPunRequestBody } from "@/lib/types";

const MAX_NAME_CHARS = 40;

export async function POST(req: NextRequest) {
  let body: RequestPunRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "A name is required." }, { status: 400 });
  }
  if (name.length > MAX_NAME_CHARS) {
    return NextResponse.json(
      { error: `Name too long (max ${MAX_NAME_CHARS} characters).` },
      { status: 400 }
    );
  }

  try {
    await recordPunRequest(name);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error.";
    // eslint-disable-next-line no-console
    console.error("puns request error:", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
