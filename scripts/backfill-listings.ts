import "dotenv/config";

/**
 * Fill in current eBay listings across the catalogue.
 *
 * `npm run ingest` runs aggregation after every ingestion pass, which walks the
 * whole catalogue. That is right for a scheduled run of 25 figures and badly
 * wrong for a backfill of thousands: the aggregation dominates, and with no
 * Marketplace Insights access there are no sales to aggregate, so it computes
 * nothing at all. This does the ingestion and stops.
 *
 * Figures are chosen by the same priority ranking the cron uses, and each one
 * is marked polled as it completes, so a run that stops early simply resumes
 * where it left off. Nothing is done twice.
 *
 *   npm run backfill:listings -- --production
 *   npm run backfill:listings -- --production --total 500
 *   npm run backfill:listings -- --total 200          # local dev database
 *
 * Both databases hold the same 7,068 figures, so a backfill aimed at the wrong
 * one looks completely successful and changes nothing on the live site. Hence
 * the explicit flag, and hence printing the host before touching anything.
 *
 * Browse API allows 5,000 calls/day by default and this spends about one per
 * figure, so 2,000 is a comfortable day's work with room to spare.
 */

function flag(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const value = i !== -1 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const PRODUCTION = process.argv.includes("--production");
const TOTAL = flag("total", 2000);
// Each batch reloads the match candidates — every figure and character in the
// catalogue — so small batches waste real time. Large ones lose progress
// reporting and restart further back if something fails. 250 is a middle.
const BATCH = flag("batch", 250);

function hhmmss(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}m${String(s % 60).padStart(2, "0")}s`;
}

async function main() {
  if (PRODUCTION) {
    const url = process.env["DIRECT_DATABASE_URL"]?.trim();
    if (!url) {
      console.error("\n  --production needs DIRECT_DATABASE_URL in .env.");
      console.error("  npm run db:check verifies it.\n");
      process.exit(1);
    }
    process.env["DATABASE_URL"] = url;
  }

  // Imported only now, because the client reads DATABASE_URL when it loads and
  // a static import would bind to the local database before the line above
  // could redirect it.
  const { prisma } = await import("../lib/prisma");
  const { runIngestion } = await import("../lib/ingest/run");

  const host = new URL(process.env["DATABASE_URL"] ?? "postgres://unset").hostname;
  console.log("");
  console.log(`  Writing to ${host}${PRODUCTION ? "  (production)" : "  (local — pass --production for the live site)"}`);

  const startedAll = Date.now();
  const before = await prisma.listing.findMany({
    distinct: ["figureId"],
    select: { figureId: true },
  });

  console.log("");
  console.log(`  Backfilling listings for up to ${TOTAL} figures, ${BATCH} at a time.`);
  console.log(`  ${before.length} figures currently have listings.`);
  console.log("");

  let done = 0;
  let seen = 0;
  let matched = 0;

  while (done < TOTAL) {
    const size = Math.min(BATCH, TOTAL - done);
    const startedBatch = Date.now();

    const summaries = await runIngestion({ sourceKeys: ["ebay"], figureLimit: size });
    const ebay = summaries.find((s) => s.source === "ebay");

    if (ebay?.error) {
      console.log(`  batch failed: ${ebay.error}`);
      console.log("  stopping — rerun to continue from here.");
      break;
    }

    done += size;
    seen += ebay?.itemsSeen ?? 0;
    matched += ebay?.itemsUpserted ?? 0;

    const elapsed = Date.now() - startedAll;
    const rate = elapsed / done;
    console.log(
      `  ${String(done).padStart(5)}/${TOTAL} figures  ` +
        `${String(seen).padStart(6)} seen  ${String(matched).padStart(5)} matched  ` +
        `batch ${hhmmss(Date.now() - startedBatch)}  ` +
        `eta ${hhmmss(rate * (TOTAL - done))}`,
    );
  }

  const after = await prisma.listing.findMany({
    distinct: ["figureId"],
    select: { figureId: true },
  });

  console.log("");
  console.log(`  Done in ${hhmmss(Date.now() - startedAll)}.`);
  console.log(`  Figures with listings: ${before.length} -> ${after.length}`);
  console.log("");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
