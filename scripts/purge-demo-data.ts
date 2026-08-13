/**
 * Remove synthetic price data, keeping the catalogue.
 *
 * Earlier seeds generated a random-walk price history so the charts had
 * something to draw. That's fine locally and unacceptable in public — a price
 * reference showing invented prices is lying to the people reading it.
 *
 * This deletes the fabricated rows and leaves the figures, manufacturers,
 * series and characters alone. Real ingestion and community reports rebuild the
 * price data from nothing.
 *
 *   npm run purge:demo            # show what would go
 *   npm run purge:demo -- --yes   # actually delete
 *
 * Against production, set DATABASE_URL for the command:
 *   $env:DATABASE_URL="…"; npm.cmd run purge:demo -- --yes
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { recomputeFigureStats } from "../lib/ingest/aggregate";

const CONFIRMED = process.argv.includes("--yes");

/** Seeded rows carry this prefix in their source-specific id. */
const SEED_PREFIX = "seed-";

async function main() {
  const seeded = { externalId: { startsWith: SEED_PREFIX } };

  const [sales, listings, snapshots, realSales] = await Promise.all([
    prisma.sale.count({ where: seeded }),
    prisma.listing.count({ where: seeded }),
    // Snapshots carry no marker because they're derived. They're rebuilt from
    // whatever sales survive, so clearing all of them is safe and correct.
    prisma.priceSnapshot.count(),
    prisma.sale.count({ where: { NOT: seeded } }),
  ]);

  console.log("Synthetic rows found:");
  console.log(`  sales      : ${sales}`);
  console.log(`  listings   : ${listings}`);
  console.log(`  snapshots  : ${snapshots}  (all — derived, will be rebuilt)`);
  console.log(`\nReal sales that will be kept: ${realSales}`);

  if (!CONFIRMED) {
    console.log("\nDry run. Re-run with --yes to delete.");
    await prisma.$disconnect();
    return;
  }

  console.log("\nDeleting…");
  const deletedSnapshots = await prisma.priceSnapshot.deleteMany({});
  const deletedSales = await prisma.sale.deleteMany({ where: seeded });
  const deletedListings = await prisma.listing.deleteMany({ where: seeded });

  console.log(`  ${deletedSnapshots.count} snapshots`);
  console.log(`  ${deletedSales.count} sales`);
  console.log(`  ${deletedListings.count} listings`);

  // Clears marketValueUsd and change30dPct for figures with nothing left to
  // compute from, so the site shows "—" rather than a stale invented number.
  console.log("\nRecomputing figure statistics…");
  await recomputeFigureStats();

  const priced = await prisma.figure.count({ where: { marketValueUsd: { not: null } } });
  const total = await prisma.figure.count();
  console.log(`  ${priced} of ${total} figures now have a market value`);

  if (priced === 0) {
    console.log("\nNo figure has a price. That's expected and honest —");
    console.log("run `npm run ingest` for live listings, and enable community");
    console.log("sale reporting to start building real history.");
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
