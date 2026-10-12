import "dotenv/config";
import { prisma } from "../lib/prisma";

/**
 * Fold one catalogue entry into another, by hand, when a person has decided
 * they are the same product.
 *
 *   npx tsx scripts/fold-figures.ts --pair keep-slug:fold-slug            # report
 *   npx tsx scripts/fold-figures.ts --pair keep-slug:fold-slug --write
 *   (--pair repeats)
 *
 * merge-reissues.ts folds by rule and moves only what a reissue needs: its
 * listings and the people who own or want it. This is for the pairs no rule
 * can find -- two shops importing one product with no identifier in common,
 * like Kotobukiya US (an SKU, no barcode) and Solaris (a barcode, no SKU) both
 * adding the 2:1 PUNI☆MOFU Tu. So it moves everything that points at the
 * folded entry, because what one shop knew about the product is still true of
 * the survivor: its shop offer, its barcode, its stored source data.
 *
 * Refuses a pair whose makers differ, either side already folded, or a shop
 * offer from the same shop on both sides with different links -- that last is
 * two products, or one the shops disagree about, and a person should look.
 *
 * Nothing is deleted. The folded entry keeps its facts and its page, which
 * now redirects to the survivor.
 */

const WRITE = process.argv.includes("--write");

function pairs(): { keep: string; fold: string }[] {
  const out: { keep: string; fold: string }[] = [];
  process.argv.forEach((arg, i) => {
    if (arg !== "--pair") return;
    const [keep, fold] = (process.argv[i + 1] ?? "").split(":");
    if (!keep || !fold) throw new Error(`--pair wants keep-slug:fold-slug, got "${process.argv[i + 1]}"`);
    out.push({ keep, fold });
  });
  return out;
}

const pick = {
  id: true,
  slug: true,
  name: true,
  supersededById: true,
  manufacturer: { select: { name: true } },
  shopOffers: { select: { id: true, source: true, url: true } },
  identifiers: { select: { id: true, kind: true, value: true } },
  wishlistItems: { select: { id: true, userId: true } },
  snapshots: { select: { id: true, condition: true, date: true } },
  _count: {
    select: {
      listings: true,
      sales: true,
      collectionItems: true,
      priceAlerts: true,
      images: true,
      submissions: true,
      candidates: true,
      sourceProducts: true,
    },
  },
} as const;

async function main() {
  const todo = pairs();
  if (!todo.length) throw new Error("nothing to do: pass --pair keep-slug:fold-slug");
  console.log(WRITE ? "\n  WRITING\n" : "\n  Report only — pass --write to apply.\n");

  for (const { keep, fold } of todo) {
    const [k, f] = await Promise.all([
      prisma.figure.findUnique({ where: { slug: keep }, select: pick }),
      prisma.figure.findUnique({ where: { slug: fold }, select: pick }),
    ]);
    console.log(`  ${fold}\n    -> ${keep}`);

    const refuse = (why: string) => console.log(`    REFUSED: ${why}\n`);
    if (!k || !f) { refuse(`${!k ? keep : fold} does not exist`); continue; }
    if (k.id === f.id) { refuse("the same entry twice"); continue; }
    if (k.supersededById || f.supersededById) { refuse("one side is already folded"); continue; }
    if (k.manufacturer?.name !== f.manufacturer?.name) {
      refuse(`makers differ: ${k.manufacturer?.name} / ${f.manufacturer?.name}`);
      continue;
    }
    const clash = f.shopOffers.find((o) => k.shopOffers.some((x) => x.source === o.source && x.url !== o.url));
    if (clash) { refuse(`both have a ${clash.source} offer, with different links`); continue; }

    // Offers and snapshots are unique per figure, so only the ones the
    // survivor does not already hold can move; the rest are the same fact.
    const offers = f.shopOffers.filter((o) => !k.shopOffers.some((x) => x.source === o.source));
    const snapKey = (s: { condition: string; date: Date }) => `${s.condition}|${s.date.toISOString()}`;
    const keptSnaps = new Set(k.snapshots.map(snapKey));
    const snaps = f.snapshots.filter((s) => !keptSnaps.has(snapKey(s)));
    const wishers = new Set(k.wishlistItems.map((w) => w.userId));
    const wishes = f.wishlistItems.filter((w) => !wishers.has(w.userId));

    const c = f._count;
    console.log(
      `    moves ${c.listings} listing(s), ${offers.length} shop offer(s) ${offers.map((o) => o.source).join(",")}, ` +
        `${f.identifiers.length} identifier(s) ${f.identifiers.map((i) => `${i.kind}:${i.value}`).join(",")}, ` +
        `${c.sourceProducts} source product(s), ${snaps.length} snapshot(s)`,
    );
    const people = c.collectionItems + f.wishlistItems.length + c.priceAlerts;
    if (people) console.log(`    and ${people} collection/wishlist/alert entr(ies), which follow it`);

    if (!WRITE) { console.log(""); continue; }

    await prisma.$transaction([
      prisma.listing.updateMany({ where: { figureId: f.id }, data: { figureId: k.id } }),
      prisma.sale.updateMany({ where: { figureId: f.id }, data: { figureId: k.id } }),
      prisma.shopOffer.updateMany({ where: { id: { in: offers.map((o) => o.id) } }, data: { figureId: k.id } }),
      prisma.figureIdentifier.updateMany({ where: { figureId: f.id }, data: { figureId: k.id } }),
      prisma.sourceProduct.updateMany({ where: { figureId: f.id }, data: { figureId: k.id } }),
      prisma.figureCandidate.updateMany({ where: { figureId: f.id }, data: { figureId: k.id } }),
      prisma.submission.updateMany({ where: { figureId: f.id }, data: { figureId: k.id } }),
      prisma.figureImage.updateMany({ where: { figureId: f.id }, data: { figureId: k.id } }),
      prisma.priceSnapshot.updateMany({ where: { id: { in: snaps.map((s) => s.id) } }, data: { figureId: k.id } }),
      prisma.collectionItem.updateMany({ where: { figureId: f.id }, data: { figureId: k.id } }),
      prisma.wishlistItem.updateMany({ where: { id: { in: wishes.map((w) => w.id) } }, data: { figureId: k.id } }),
      prisma.priceAlert.updateMany({ where: { figureId: f.id }, data: { figureId: k.id } }),
      prisma.figure.update({ where: { id: f.id }, data: { supersededById: k.id } }),
    ]);
    console.log("    folded.\n");
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
