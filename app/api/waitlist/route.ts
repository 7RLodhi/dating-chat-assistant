import { NextRequest, NextResponse } from "next/server";
import { recordWaitlistEmail } from "@/lib/store";

export async function POST(req: NextRequest) {
  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const email = body.email?.trim();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email required." }, { status: 400 });
  }

  const result = await recordWaitlistEmail(email);
  if (!result.ok) {
    return NextResponse.json({ error: "Failed to save email." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, alreadyExists: result.alreadyExists ?? false });
}
