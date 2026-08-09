/**
 * Run ingestion from the command line, for testing without waiting on a cron.
 *
 *   npm run ingest              # every enabled source, 25 figures
 *   npm run ingest -- --source ebay --limit 5
 *   npm run ingest -- --aggregate-only
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { runIngestion } from "../lib/ingest/run";
import { runAggregation } from "../lib/ingest/aggregate";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const aggregateOnly = process.argv.includes("--aggregate-only");

  if (!aggregateOnly) {
    const source = flag("source");
    const limit = Number(flag("limit") ?? 25);

    console.log(`Ingesting${source ? ` from ${source}` : ""} (${limit} figures)…`);
    const summaries = await runIngestion({
      sourceKeys: source ? [source] : undefined,
      figureLimit: Number.isFinite(limit) ? limit : 25,
    });

    for (const s of summaries) {
      console.log(
        `  ${s.source}: ${s.itemsSeen} seen, ${s.itemsUpserted} matched, ` +
          `${s.unmatched} unmatched${s.error ? ` — ERROR: ${s.error}` : ""}`,
      );
    }
  }

  console.log("Aggregating…");
  const result = await runAggregation();
  console.log(
    `  ${result.snapshotsWritten} snapshots written, ${result.figuresUpdated} figures updated`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
