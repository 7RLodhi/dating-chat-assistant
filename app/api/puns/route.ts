import { NextRequest, NextResponse } from "next/server";
import { addNamePun, listNamePuns } from "@/lib/store";
import { AddPunRequestBody } from "@/lib/types";

const MAX_NAME_CHARS = 40;
const MAX_PUN_CHARS = 200;

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams.get("search") ?? undefined;
  const puns = await listNamePuns(search);
  return NextResponse.json({ puns });
}

export async function POST(req: NextRequest) {
  let body: AddPunRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = body.name?.trim();
  const pun = body.pun?.trim();
  if (!name || !pun) {
    return NextResponse.json(
      { error: "Both a name and a pun line are required." },
      { status: 400 }
    );
  }
  if (name.length > MAX_NAME_CHARS) {
    return NextResponse.json(
      { error: `Name too long (max ${MAX_NAME_CHARS} characters).` },
      { status: 400 }
    );
  }
  if (pun.length > MAX_PUN_CHARS) {
    return NextResponse.json(
      { error: `Pun too long (max ${MAX_PUN_CHARS} characters).` },
      { status: 400 }
    );
  }

  try {
    const entry = await addNamePun(name, pun);
    return NextResponse.json({ pun: entry });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error.";
    // eslint-disable-next-line no-console
    console.error("puns POST error:", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
