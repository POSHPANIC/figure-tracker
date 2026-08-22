import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { runIngestion } from "@/lib/ingest/run";

// Ingestion talks to external APIs and must never be cached or prerendered.
export const maxDuration = 60;

/**
 * Pull fresh listings and sales from every enabled source.
 *
 * `figureLimit` has to fit inside maxDuration, and the two were out of step:
 * the schedule asked for 100 figures against a 60-second budget, so every run
 * was killed partway and recorded nothing at all — `finishedAt` null, zero
 * items seen, night after night. A figure costs about a second now that they
 * are polled four at a time, so 40 leaves real headroom for a slow response
 * or two.
 *
 * Raising this means raising maxDuration with it. A run that does not finish
 * is worse than a smaller one that does: the figures it managed are marked
 * polled, so the next run skips past them, and the shortfall is invisible
 * unless someone goes looking at IngestRun.
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
