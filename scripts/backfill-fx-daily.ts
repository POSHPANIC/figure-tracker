import "dotenv/config";
import { prisma } from "../lib/prisma";
import { SUPPORTED_CURRENCIES } from "../lib/currency";
import { fetchDailyQuotes } from "../lib/ingest/fx-monthly";

/**
 * Fill the daily rate table back to 1999.
 *
 * FxRate held only the days this site has been running, because until now the
 * only thing that asked for a daily rate was "convert this listing at today's
 * rate". A figure with a release date known to the day wants that day's rate,
 * and for anything released before this month there was nothing to look up.
 *
 *   npm run backfill:fx-daily            # dry run
 *   npm run backfill:fx-daily -- --yes
 *
 * One request to the provider covers the whole range — about 7,000 business
 * days for five currencies — so this is a single call. Existing rows are left
 * exactly as they are: a rate we recorded on the day we used it is the rate
 * those conversions were made at, and rewriting it would change history to
 * match a source we consulted later.
 */

const APPLY = process.argv.includes("--yes");
const CODES = SUPPORTED_CURRENCIES.map((c) => c.code).filter((c) => c !== "USD");

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "postgres://unset").hostname;
  console.log(`\n  ${APPLY ? "Writing to" : "Dry run against"} ${host}\n`);

  const quotes = await fetchDailyQuotes(CODES);
  const days = Object.keys(quotes).sort();
  console.log(`  ${days.length} business days, ${days[0]} to ${days[days.length - 1]}`);

  const rows: { currency: string; date: Date; rateToUsd: number }[] = [];
  for (const [day, byCurrency] of Object.entries(quotes)) {
    for (const [code, perUsd] of Object.entries(byCurrency)) {
      if (typeof perUsd !== "number" || !(perUsd > 0)) continue;
      rows.push({
        currency: code.toUpperCase(),
        date: new Date(`${day}T00:00:00Z`),
        // Stored as the multiplier to USD, which is what every caller wants.
        rateToUsd: 1 / perUsd,
      });
    }
  }
  console.log(`  ${rows.length} rate rows ready`);

  const before = await prisma.fxRate.count();
  console.log(`  ${before} already stored`);

  if (!APPLY) {
    console.log("\n  Dry run. Re-run with --yes to save.\n");
    await prisma.$disconnect();
    return;
  }

  // ON CONFLICT DO NOTHING, not DO UPDATE. A rate recorded on the day it was
  // used is the rate those conversions were made at; replacing it with a value
  // fetched later would quietly restate prices already shown to people.
  let written = 0;
  const BATCH = 2000;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await prisma.$executeRaw`
      INSERT INTO "FxRate" (id, currency, date, "rateToUsd")
      SELECT gen_random_uuid()::text, c, d::date, r
      FROM unnest(
        ${batch.map((r) => r.currency)}::text[],
        ${batch.map((r) => r.date.toISOString().slice(0, 10))}::text[],
        ${batch.map((r) => r.rateToUsd)}::numeric[]
      ) AS t(c, d, r)
      ON CONFLICT (currency, date) DO NOTHING`;
    written += batch.length;
    process.stdout.write(`\r  processed ${written}/${rows.length}`);
  }

  const after = await prisma.fxRate.count();
  console.log(`\n\n  Done. ${after - before} new rows, ${after} stored in total.\n`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
