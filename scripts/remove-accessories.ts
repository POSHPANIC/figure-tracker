import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { prisma } from "../lib/prisma";
import { isAccessory } from "../lib/ingest/accessory";

/**
 * Take accessories out of the catalogue.
 *
 *   npx tsx scripts/remove-accessories.ts            # report
 *   npx tsx scripts/remove-accessories.ts --write
 *
 * Decal sheets, parts sets, joint and hand sets, earrings and chopstick rests
 * came in through every importer, because shops sell them beside the figures
 * they go with under the same line name and product type. The importers now
 * refuse them (lib/ingest/accessory.ts); this clears the ones already here.
 *
 * Deleted rather than folded, because there is nothing to fold them into: a
 * decal sheet is not a duplicate of any figure. Every row is written to
 * private/ first, which is gitignored, so a mistaken removal is a restore from
 * a file rather than a loss.
 *
 * Three refusals, checked here against the database at the moment of writing
 * rather than assumed from an earlier survey:
 *
 *   - anything in a collection, a wishlist or a price alert. Those cascade on
 *     delete, so removing the figure would silently remove a person's data.
 *   - anything with a character recorded. None of the accessories found had
 *     one; a figure that does is far more likely to be a real figure with an
 *     unlucky name, and should be looked at by a person.
 *   - a real figure folded into an accessory. supersededBy is SET NULL on
 *     delete, so removing the accessory would quietly bring the folded row
 *     back to life as a live duplicate. Folded rows that are accessories
 *     themselves are removed along with what they were folded into.
 *
 * Listings attached to a removed row survive, unattached -- Listing.figure is
 * SET NULL -- so the matcher can place them elsewhere on its next pass.
 */

const WRITE = process.argv.includes("--write");

async function main() {
  console.log(WRITE ? "\n  WRITING\n" : "\n  Report only — pass --write to apply.\n");

  const all = await prisma.figure.findMany({
    select: {
      id: true,
      name: true,
      supersededById: true,
      _count: {
        select: {
          characters: true,
          collectionItems: true,
          wishlistItems: true,
          priceAlerts: true,
          listings: true,
        },
      },
    },
  });
  const accessory = all.filter((f) => isAccessory(f.name));
  const accessoryIds = new Set(accessory.map((f) => f.id));

  const refused: { name: string; why: string }[] = [];
  const remove: typeof accessory = [];

  for (const f of accessory) {
    const c = f._count;
    if (c.collectionItems || c.wishlistItems || c.priceAlerts) {
      refused.push({ name: f.name, why: "someone owns, wants or watches it" });
      continue;
    }
    if (c.characters) {
      refused.push({ name: f.name, why: `${c.characters} character(s) recorded — check by hand` });
      continue;
    }
    // A real figure folded into this one would be resurrected.
    const foldedIn = all.filter((x) => x.supersededById === f.id && !accessoryIds.has(x.id));
    if (foldedIn.length) {
      refused.push({ name: f.name, why: `real figure folded into it: ${foldedIn[0].name.slice(0, 40)}` });
      continue;
    }
    remove.push(f);
  }

  const live = remove.filter((f) => f.supersededById === null).length;
  const listings = remove.reduce((n, f) => n + f._count.listings, 0);
  console.log(`  ${accessory.length} accessor(ies) found.`);
  console.log(`  ${remove.length} to remove (${live} live, ${remove.length - live} folded copies).`);
  console.log(`  ${listings} listing(s) will be left unattached for the matcher to re-place.`);
  if (refused.length) {
    console.log(`\n  ${refused.length} refused:`);
    for (const r of refused) console.log(`     ${r.name.slice(0, 54).padEnd(54)}  ${r.why}`);
  }
  // Sanity: nothing about to go should still be referenced by a survivor.
  const dangling = all.filter(
    (x) => x.supersededById && remove.some((r) => r.id === x.supersededById) && !remove.some((r) => r.id === x.id),
  );
  if (dangling.length) throw new Error(`refusing: ${dangling.length} survivor(s) folded into a removed row`);

  if (!WRITE) {
    console.log("\n  Nothing written.\n");
    await prisma.$disconnect();
    return;
  }

  // The backup, in full, before anything is touched.
  const ids = remove.map((f) => f.id);
  const backup = await prisma.figure.findMany({
    where: { id: { in: ids } },
    include: { identifiers: true, shopOffers: true, images: true, fieldLocks: true },
  });
  mkdirSync("private", { recursive: true });
  const file = `private/removed-accessories-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(file, JSON.stringify(backup, null, 2));
  console.log(`\n  Backed up ${backup.length} row(s) to ${file}`);

  // Folded copies first, so no survivor ever points at a deleted row mid-way.
  const order = [...remove].sort((a, b) => (a.supersededById ? 0 : 1) - (b.supersededById ? 0 : 1));
  const { count } = await prisma.$transaction(async (tx) => {
    let removed = 0;
    for (const f of order) {
      await tx.figure.delete({ where: { id: f.id } });
      removed += 1;
    }
    return { count: removed };
  }, { timeout: 120_000, maxWait: 30_000 });

  console.log(`  Removed ${count} accessor(ies).\n`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
