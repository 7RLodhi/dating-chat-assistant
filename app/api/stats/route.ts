import { NextResponse } from "next/server";
import { getStats } from "@/lib/stats";

export async function GET() {
  try {
    return NextResponse.json(await getStats());
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("stats route error:", err);
    return NextResponse.json({ error: "Could not load stats." }, { status: 500 });
  }
}
