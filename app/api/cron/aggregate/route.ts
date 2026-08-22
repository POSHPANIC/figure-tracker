import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { purgeExpiredSales, runAggregation } from "@/lib/ingest/aggregate";

export const maxDuration = 60;

/**
 * Roll yesterday's sales into daily price snapshots and refresh every figure's
 * market value. Runs after ingestion so it sees the day's freshly pulled data.
 *
 * Then drops individual sales older than the 90-day window eBay's Marketplace
 * Insights covers, which is what we told them we would do. Summarise first,
 * delete second — the other order loses the day it was about to summarise.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runAggregation();
    const purged = await purgeExpiredSales();
    return NextResponse.json({ ok: true, ...result, salesPurged: purged });
  } catch (err) {
    console.error("[cron/aggregate] failed:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
