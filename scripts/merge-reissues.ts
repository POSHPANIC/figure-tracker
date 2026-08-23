/**
 * Fold reissue entries into the product they are a reissue of.
 *
 * Good Smile publishes a reissue as its own archive entry, so the catalogue
 * holds two rows for one figure: same name, maker, category, scale and height,
 * a later release date, sometimes a higher price. A seller's title cannot tell
 * them apart — nobody writes "the 2021 reissue" — so the matcher scored both
 * identically, called it a tie, and refused to answer. bestMatch is right to do
 * that, and the cost is that every listing for those products went unmatched.
 *
 * What counts as the same product, deliberately strictly:
 *
 *   - identical name, manufacturer, category, scale and height
 *   - at most one distinct release number between them
 *
 * That last rule is doing real work. "figma Hero" exists twice with matching
 * everything and the numbers EX-050 and 256 — two genuinely different products
 * that happen to share a name, and merging them would have been a fabrication.
 * Price is allowed to differ, because a reissue is exactly where it changes:
 * Nendoroid Nezuko went from ¥5,900 to ¥5,500, Anya Forger from ¥6,500 to
 * ¥6,800.
 *
 * The survivor is the entry carrying a release number, then the one with more
 * listings. That is the row a title can actually be matched against.
 *
 * Nothing is deleted. The superseded row keeps its facts and its page, which
 * redirects; its listings move to the survivor, because a listing should point
 * at the entry the site will actually show.
 *
 *   npx tsx scripts/merge-reissues.ts           # report
 *   npx tsx scripts/merge-reissues.ts --write
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";

const WRITE = process.argv.includes("--write");

type Row = {
  id: string;
  name: string;
  slug: string;
  category: string;
  scale: string | null;
  heightMm: number | null;
  releaseDate: Date | null;
  msrpAmount: unknown;
  supersededById: string | null;
  manufacturer: { name: string } | null;
  identifiers: { kind: string; value: string }[];
  _count: { listings: number; collectionItems: number; wishlistItems: number };
};

/** The release numbers an entry carries, if any. */
function numbersOf(f: Row): string[] {
  return f.identifiers.filter((i) => i.kind.endsWith("_NO")).map((i) => i.value);
}

/** Everything that must agree before two entries can be one product. */
function identityKey(f: Row): string {
  return [
    f.manufacturer?.name ?? "?",
    f.category,
    f.scale ?? "-",
    f.heightMm ?? "-",
  ].join("|");
}

async function main() {
  const dupNames = await prisma.$queryRaw<{ name: string }[]>`
    SELECT name FROM "Figure" GROUP BY name HAVING count(*) > 1
  `;

  const rows = (await prisma.figure.findMany({
    where: { name: { in: dupNames.map((n) => n.name) } },
    select: {
      id: true, name: true, slug: true, category: true, scale: true, heightMm: true,
      releaseDate: true, msrpAmount: true, supersededById: true,
      manufacturer: { select: { name: true } },
      identifiers: { select: { kind: true, value: true } },
      _count: { select: { listings: true, collectionItems: true, wishlistItems: true } },
    },
    orderBy: [{ name: "asc" }, { releaseDate: "asc" }],
  })) as unknown as Row[];

  const byName = new Map<string, Row[]>();
  for (const r of rows) {
    const list = byName.get(r.name) ?? [];
    list.push(r);
    byName.set(r.name, list);
  }

  let merged = 0;
  let movedListings = 0;
  let skipped = 0;

  for (const [name, group] of byName) {
    // Within a name, only entries agreeing on every identity field can be the
    // same product. Several groups hold two unrelated pairs.
    const buckets = new Map<string, Row[]>();
    for (const f of group) {
      const k = identityKey(f);
      const list = buckets.get(k) ?? [];
      list.push(f);
      buckets.set(k, list);
    }

    for (const bucket of buckets.values()) {
      if (bucket.length < 2) continue;

      const distinctNumbers = new Set(bucket.flatMap(numbersOf));
      if (distinctNumbers.size > 1) {
        skipped += 1;
        console.log(`  skip  ${name.slice(0, 54)} — different numbers: ${[...distinctNumbers].join(", ")}`);
        continue;
      }

      // Whichever row a listing can actually be matched to.
      const survivor = [...bucket].sort((a, b) => {
        const an = numbersOf(a).length > 0 ? 1 : 0;
        const bn = numbersOf(b).length > 0 ? 1 : 0;
        if (an !== bn) return bn - an;
        if (a._count.listings !== b._count.listings) return b._count.listings - a._count.listings;
        return (a.releaseDate?.getTime() ?? 0) - (b.releaseDate?.getTime() ?? 0);
      })[0];

      const folded = bucket.filter((f) => f.id !== survivor.id);
      const held = folded.reduce((n, f) => n + f._count.collectionItems + f._count.wishlistItems, 0);

      console.log(`\n  ${name.slice(0, 58)}`);
      console.log(`     keep  ${survivor.releaseDate?.toISOString().slice(0, 7) ?? "no date"}  ${numbersOf(survivor).join(",") || "no number"}  ${survivor._count.listings} listings  ${survivor.slug.slice(0, 44)}`);
      for (const f of folded) {
        console.log(`     fold  ${f.releaseDate?.toISOString().slice(0, 7) ?? "no date"}  ${numbersOf(f).join(",") || "no number"}  ${f._count.listings} listings  ${f.slug.slice(0, 44)}`);
      }
      if (held > 0) console.log(`     note: ${held} collection/wishlist entr(ies) point at a folded row and will follow it`);

      merged += folded.length;
      movedListings += folded.reduce((n, f) => n + f._count.listings, 0);

      if (WRITE) {
        for (const f of folded) {
          await prisma.$transaction([
            prisma.listing.updateMany({ where: { figureId: f.id }, data: { figureId: survivor.id } }),
            prisma.collectionItem.updateMany({ where: { figureId: f.id }, data: { figureId: survivor.id } }),
            prisma.wishlistItem.updateMany({ where: { figureId: f.id }, data: { figureId: survivor.id } }),
            prisma.figure.update({ where: { id: f.id }, data: { supersededById: survivor.id } }),
          ]);
        }
      }
    }
  }

  console.log(`\n  ${merged} entr(ies) folded, ${movedListings} listing(s) moved, ${skipped} group(s) left alone.`);
  if (!WRITE) console.log("  Report only — pass --write to apply.");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
