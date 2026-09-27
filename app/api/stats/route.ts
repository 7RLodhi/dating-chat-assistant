import { NextResponse } from "next/server";
import { getStats } from "@/lib/stats";

// Aggregates live backend data on every hit — must never be statically
// optimized or edge-cached, or the dashboard freezes on first view.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getStats());
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("stats route error:", err);
    return NextResponse.json({ error: "Could not load stats." }, { status: 500 });
  }
}
