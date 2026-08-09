import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { runAggregation } from "@/lib/ingest/aggregate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Roll yesterday's sales into daily price snapshots and refresh every figure's
 * market value. Runs after ingestion so it sees the day's freshly pulled data.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runAggregation();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/aggregate] failed:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
