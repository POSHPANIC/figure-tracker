import "dotenv/config";
import { prisma } from "../lib/prisma";
import { SUPPORTED_CURRENCIES } from "../lib/currency";
import { averageByMonth, fetchDailyQuotes, monthStart } from "../lib/ingest/fx-monthly";

/**
 * Fill the monthly rate table, so a price set in the past converts at the rate
 * of the month it was set in.
 *
 *   npm run backfill:fx            # dry run
 *   npm run backfill:fx -- --yes
 *
 * One request to the provider covers the whole range — every business day back
 * to 1999 for the five currencies we display, about half a megabyte — so this
 * is a single call rather than a crawl, and cheap enough to re-run.
 *
 * Safe to run repeatedly. Past months are settled and rewrite to the same
 * numbers; the current month is still accumulating days and will move slightly
 * until it ends, which is why `days` is stored alongside the rate.
 */

const APPLY = process.argv.includes("--yes");
const CODES = SUPPORTED_CURRENCIES.map((c) => c.code).filter((c) => c !== "USD");

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "postgres://unset").hostname;
  console.log(`\n  ${APPLY ? "Writing to" : "Dry run against"} ${host}`);
  console.log(`  Currencies: ${CODES.join(", ")}\n`);

  const quotes = await fetchDailyQuotes(CODES);
  const days = Object.keys(quotes).sort();
  console.log(`  ${days.length} business days, ${days[0]} to ${days[days.length - 1]}`);

  const byCurrency = averageByMonth(quotes);

  const rows: { currency: string; month: Date; rateToUsd: number; days: number }[] = [];
  for (const [currency, months] of byCurrency) {
    for (const [month, rate] of months) {
      rows.push({
        currency,
        month: monthStart(new Date(`${month}-01T00:00:00Z`)),
        rateToUsd: rate.rateToUsd,
        days: rate.days,
      });
    }
  }
  rows.sort((a, b) => a.currency.localeCompare(b.currency) || a.month.getTime() - b.month.getTime());

  for (const code of CODES) {
    const mine = rows.filter((r) => r.currency === code);
    if (mine.length === 0) {
      console.log(`  ${code}: nothing returned — the provider may not carry it`);
      continue;
    }
    const first = mine[0];
    const last = mine[mine.length - 1];
    const show = (r: (typeof mine)[number]) =>
      `${r.month.toISOString().slice(0, 7)} ${(1 / r.rateToUsd).toFixed(2)}/USD`;
    console.log(`  ${code}: ${mine.length} months, ${show(first)} → ${show(last)}`);
  }

  // A month built from one or two quotes is not wrong, but it is worth seeing.
  const thin = rows.filter((r) => r.days < 5);
  if (thin.length > 0) {
    console.log(`\n  ${thin.length} month(s) averaged from fewer than 5 days:`);
    for (const r of thin.slice(0, 10)) {
      console.log(`    ${r.currency} ${r.month.toISOString().slice(0, 7)} — ${r.days} day(s)`);
    }
  }

  if (!APPLY) {
    console.log(`\n  Dry run. ${rows.length} rows ready. Re-run with --yes to save.\n`);
    await prisma.$disconnect();
    return;
  }

  // One statement per batch, not a transaction of upserts. Prisma's interactive
  // transactions time out at five seconds, and 500 round trips to a hosted
  // database do not fit in that — the first attempt at this died with P2028.
  let written = 0;
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await prisma.$executeRaw`
      INSERT INTO "FxMonthly" (id, currency, month, "rateToUsd", days)
      SELECT gen_random_uuid()::text, c, m::date, r, d
      FROM unnest(
        ${batch.map((r) => r.currency)}::text[],
        ${batch.map((r) => r.month.toISOString().slice(0, 10))}::text[],
        ${batch.map((r) => r.rateToUsd)}::numeric[],
        ${batch.map((r) => r.days)}::int[]
      ) AS t(c, m, r, d)
      ON CONFLICT (currency, month) DO UPDATE
        SET "rateToUsd" = EXCLUDED."rateToUsd", days = EXCLUDED.days`;
    written += batch.length;
    console.log(`  saved ${written}/${rows.length}`);
  }


  console.log(`\n  Done. ${written} monthly rates stored.\n`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
