import { NextResponse } from "next/server";
import { getStats } from "@/lib/stats";

// This route previously had no dynamic export at all, which let Next.js
// statically optimize it — the dashboard served one frozen response
// forever. `force-dynamic` fixed staleness but went to the other extreme:
// every single hit re-read and re-aggregated all three tables from
// scratch (see lib/stats.ts), with zero caching. `revalidate` is the
// middle ground: at most 30s stale, and full recomputation happens at
// most once per 30s regardless of traffic, not once per request.
export const revalidate = 30;

export async function GET() {
  try {
    const stats = await getStats();
    return NextResponse.json(stats, {
      headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60" },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("stats route error:", err);
    return NextResponse.json({ error: "Could not load stats." }, { status: 500 });
  }
}
