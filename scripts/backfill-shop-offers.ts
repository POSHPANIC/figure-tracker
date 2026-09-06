import "dotenv/config";
import { prisma } from "../lib/prisma";
import type { ShopSource } from "../lib/ingest/shop-offer";

/**
 * Move the store link every figure already has onto its own offer row.
 *
 *   npx tsx scripts/backfill-shop-offers.ts            # report
 *   npx tsx scripts/backfill-shop-offers.ts --write
 *
 * Figure.storeUrl is a single slot that five importers write, so it holds
 * whichever shop ran most recently. That is one real offer per figure and the
 * only record we have of the rest; this copies what is there into ShopOffer so
 * the figures already imported start with the shop they are known to, rather
 * than waiting for each importer to come round again.
 *
 * The source is read off the host, which is the only evidence a copied row
 * carries. From here on importers state their own source, so this inference
 * runs exactly once.
 */

const WRITE = process.argv.includes("--write");

const SOURCE_BY_HOST: [RegExp, ShopSource][] = [
  [/(^|\.)kotobukiya-us\.com$/i, "KOTOBUKIYA"],
  [/(^|\.)solarisjapan\.com$/i, "SOLARIS"],
  [/(^|\.)nin-nin-game\.com$/i, "NINNIN"],
  [/(^|\.)hlj\.com$/i, "HLJ"],
  [/(^|\.)goodsmile\.com$/i, "GOODSMILE"],
  [/(^|\.)1999\.co\.jp$/i, "HOBBYSEARCH"],
];

function sourceOf(url: string): ShopSource | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  for (const [pattern, source] of SOURCE_BY_HOST) if (pattern.test(host)) return source;
  // A link somebody pasted into the correction form, pointing anywhere. It is
  // still a real offer, and MANUAL is the honest name for where it came from.
  return "MANUAL";
}

async function main() {
  console.log(WRITE ? "WRITING\n" : "Report only — pass --write to apply.\n");

  const figures = await prisma.figure.findMany({
    where: { supersededById: null, storeUrl: { not: null } },
    select: {
      id: true,
      storeUrl: true,
      storePriceAmount: true,
      storePriceCurrency: true,
      storeAvailable: true,
      storeClosesAt: true,
      storeCheckedAt: true,
    },
  });

  const tally: Record<string, number> = {};
  let written = 0;
  let alreadyThere = 0;
  let unreadable = 0;

  for (const f of figures) {
    const source = sourceOf(f.storeUrl!);
    if (!source) {
      unreadable += 1;
      continue;
    }
    tally[source] = (tally[source] ?? 0) + 1;

    if (!WRITE) continue;

    const existing = await prisma.shopOffer.findUnique({
      where: { figureId_source: { figureId: f.id, source } },
      select: { id: true },
    });
    // An importer has already written this shop's row, and it did so from the
    // live page. That is better evidence than a copied column.
    if (existing) {
      alreadyThere += 1;
      continue;
    }

    await prisma.shopOffer.create({
      data: {
        figureId: f.id,
        source,
        url: f.storeUrl!,
        priceAmount: f.storePriceAmount,
        priceCurrency: f.storePriceCurrency,
        available: f.storeAvailable,
        closesAt: f.storeClosesAt,
        checkedAt: f.storeCheckedAt ?? new Date(),
      },
    });
    written += 1;
  }

  console.log(`  ${figures.length} figure(s) carry a store link.`);
  for (const [s, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${String(n).padStart(5)}  ${s}`);
  }
  if (unreadable) console.log(`  ${unreadable} link(s) could not be parsed as a URL.`);
  if (WRITE) {
    console.log(`\n  ${written} offer(s) created, ${alreadyThere} already recorded by an importer.`);
  } else {
    console.log(`\n  Nothing written — this was a report.`);
  }
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
