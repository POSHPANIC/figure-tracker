import "dotenv/config";
import { prisma } from "../lib/prisma";
import { recordFolded } from "../lib/ingest/figure-release";
import { isSeparatePrinting } from "../lib/ingest/releases";

/**
 * Give every already-folded reissue a FigureRelease row on its survivor.
 *
 *   npx tsx scripts/backfill-folded-releases.ts           # report
 *   npx tsx scripts/backfill-folded-releases.ts --write
 *
 * Folding kept a reissue's release date and price on the folded row, which
 * nothing reads. The fold scripts now record it as they fold; this catches up
 * the entries folded before they did. Safe to run again: it upserts.
 */

const WRITE = process.argv.includes("--write");
const pick = { id: true, slug: true, name: true, releaseDate: true, releaseDatePrecision: true, msrpAmount: true, msrpCurrency: true } as const;

async function main() {
  const folded = await prisma.figure.findMany({
    where: { supersededById: { not: null } },
    select: { ...pick, identifiers: { where: { kind: "JAN" }, select: { value: true } }, supersededBy: { select: pick } },
  });
  let kept = 0;
  for (const f of folded) {
    const s = f.supersededBy!;
    const separate = isSeparatePrinting(f.releaseDate, s.releaseDate);
    console.log(
      `  ${separate ? "keep" : "same"}  ${f.releaseDate?.toISOString().slice(0, 7) ?? "  -    "} -> ${s.releaseDate?.toISOString().slice(0, 7) ?? "   -   "}  ${s.name.slice(0, 60)}`,
    );
    if (!separate) continue;
    kept += 1;
    if (WRITE) await recordFolded(s, f, f.identifiers[0]?.value ?? null);
  }
  console.log(`\n  ${folded.length} folded entr(ies); ${kept} a printing of their own${WRITE ? ", written" : " — pass --write"}.`);
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
