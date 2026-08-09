import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { runIngestion } from "@/lib/ingest/run";

// Ingestion talks to external APIs and must never be cached or prerendered.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Pull fresh listings and sales from every enabled source.
 *
 * `figureLimit` keeps a single invocation inside the serverless timeout. The
 * runner processes least-recently-updated figures first, so consecutive runs
 * work their way through the whole catalog instead of re-doing the same head.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 25);

  try {
    const summaries = await runIngestion({
      figureLimit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 25,
    });
    return NextResponse.json({ ok: true, summaries });
  } catch (err) {
    console.error("[cron/ingest] failed:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
