import "dotenv/config";
import { prisma } from "../lib/prisma";
import { linkFor, type FigureLike } from "../lib/ingest/source-product";
import { fillMissing } from "../lib/ingest/shop-offer";

/**
 * Link stored products to the figures they turn out to be.
 *
 *   npx tsx scripts/link-source-products.ts            # report
 *   npx tsx scripts/link-source-products.ts --write
 *
 * SourceProduct rows are facts a source gave us that we could not act on. Alter
 * publish a price, a scale, a height and a release month for 633 products and
 * an English name for 153, so 480 of them are stored rather than created — a
 * Japanese name in an English catalogue can be neither searched for nor matched
 * against an English marketplace title.
 *
 * Those products do arrive later, under English names, from a retailer that
 * stocks them or a seller that lists one. This is the pass that notices, and
 * what it gains is the manufacturer's own price on a figure that would
 * otherwise carry only a retailer's.
 *
 * Run after the importers, because every import is a chance that the figure a
 * stored row has been waiting for now exists.
 *
 * Nothing here overwrites. fillMissing only touches empty columns and never a
 * locked one, so a linked row can add an MSRP and cannot rewrite a scale
 * somebody checked against the box.
 */

const WRITE = process.argv.includes("--write");

async function main() {
  console.log(WRITE ? "\n  WRITING\n" : "\n  Report only — pass --write to apply.\n");

  const pending = await prisma.sourceProduct.findMany({
    where: { figureId: null },
    orderBy: { firstSeenAt: "asc" },
  });
  if (pending.length === 0) {
    console.log("  Nothing waiting.\n");
    await prisma.$disconnect();
    return;
  }

  // The whole live catalogue, once. It is a few thousand rows and every stored
  // product is compared against all of them; querying per row would be
  // thousands of round trips to answer the same question.
  const figures: FigureLike[] = (
    await prisma.figure.findMany({
      where: { supersededById: null },
      select: {
        id: true,
        nameJa: true,
        scale: true,
        heightMm: true,
        releaseDate: true,
        manufacturer: { select: { name: true } },
      },
    })
  ).map((f) => ({
    id: f.id,
    nameJa: f.nameJa,
    manufacturerName: f.manufacturer?.name ?? null,
    scale: f.scale,
    heightMm: f.heightMm,
    releaseDate: f.releaseDate,
  }));

  const byJan = new Map<string, string>();
  for (const i of await prisma.figureIdentifier.findMany({
    where: { kind: "JAN" },
    select: { value: true, figureId: true },
  })) {
    byJan.set(i.value, i.figureId);
  }

  const tally = { jan: 0, nameJa: 0, specs: 0, unmatched: 0, filled: 0 };

  for (const row of pending) {
    // A barcode is the product's identity and needs no corroboration, so it is
    // resolved here rather than in the rules module.
    const janMatch = row.jan ? (byJan.get(row.jan) ?? null) : null;
    const link = janMatch
      ? ({ figureId: janMatch, by: "jan" } as const)
      : linkFor(
          {
            nameJa: row.nameJa,
            jan: row.jan,
            manufacturerName: row.manufacturerName,
            scale: row.scale,
            heightMm: row.heightMm,
            releaseDate: row.releaseDate,
          },
          figures,
        );

    if (!link) {
      tally.unmatched += 1;
      continue;
    }
    tally[link.by] += 1;

    if (!WRITE) continue;

    const filled = await fillMissing(link.figureId, {
      nameJa: row.nameJa,
      scale: row.scale,
      heightMm: row.heightMm,
      releaseDate: row.releaseDate,
      msrpAmount: row.msrpAmount === null ? null : Number(String(row.msrpAmount)),
      msrpCurrency: row.msrpCurrency,
    });
    if (filled.length) tally.filled += 1;

    await prisma.sourceProduct.update({
      where: { id: row.id },
      data: { figureId: link.figureId, linkedBy: link.by, linkedAt: new Date() },
    });
    console.log(`  linked by ${link.by.padEnd(7)} ${(row.nameJa ?? row.name ?? row.key).slice(0, 34).padEnd(34)} ${filled.length ? `+${filled.join(",")}` : "(nothing missing)"}`);
  }

  console.log(`\n  ${pending.length} stored product(s) waiting.`);
  console.log(`    linked by barcode       ${tally.jan}`);
  console.log(`    linked by Japanese name ${tally.nameJa}`);
  console.log(`    linked by specification ${tally.specs}`);
  console.log(`    still unmatched         ${tally.unmatched}`);
  if (WRITE) console.log(`    of those linked, ${tally.filled} had something missing to fill.`);
  console.log("");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
