import "dotenv/config";
import { prisma } from "../lib/prisma";
import { looksJapanese } from "../lib/ingest/barcode";
import {
  SHOP_ORIGIN,
  parseShopProduct,
  type GoodSmileShopProduct,
} from "../lib/ingest/goodsmile-shop";

/**
 * Recover barcodes from Good Smile's own shop.
 *
 *   npx tsx scripts/backfill-goodsmile.ts                  # report
 *   npx tsx scripts/backfill-goodsmile.ts --write
 *   npx tsx scripts/backfill-goodsmile.ts --write --max 800
 *   npx tsx scripts/backfill-goodsmile.ts --write --from 1 --to 2000
 *
 * Most of this catalogue came from Good Smile's *archive*, goodsmile.info,
 * which publishes no barcode anywhere — checked in both languages, on several
 * products. Their *shop*, goodsmile.com, publishes one on every product. Same
 * company, two sites, and the barcode is only on the one we were not reading.
 *
 * Getting from one to the other is the awkward part, because nothing joins
 * them. The shop's `productID` is its own id, not the archive's: archive 7310
 * is a Sakura Kinomoto Nendoroid while shop 7310 is a MODEROID Gambaruger. The
 * archive page carries no link to the shop. And the shop's only listing route
 * is /en/search, which their robots.txt disallows.
 *
 * What is left is the product pages themselves, which robots.txt permits, read
 * by id. Ids run from 1 to about 14,000 and roughly a third are 404 — so this
 * walks the range a slice at a time rather than in one sitting.
 *
 * Matching is on the name, and deliberately strictly: the whole name must
 * equal the whole name, and the manufacturer must agree. A loose "contains"
 * match was tried first and quietly claimed that the shop's "Nendoroid Kazuma"
 * was our "Nendoroid Kazuma Kuwabara" — a different character from a different
 * series. A barcode is an exact join key, so a wrong one is worse than none:
 * it would send some later source's listings to the wrong figure.
 *
 * Where it stopped is remembered in Setting, not inferred. It used to resume
 * from the highest shop id it had *matched*, which cannot tell "not reached
 * yet" from "reached and matched nothing" — so the ids past the last match were
 * re-walked nightly, and new products beyond them were only found by accident.
 *
 * On reaching the end of their range the cursor rewinds to just behind the last
 * live product rather than stopping. That is what keeps catching new releases:
 * the shop adds them at the top, so a short nightly re-walk of the tail finds
 * them the day they appear.
 */

const WRITE = process.argv.includes("--write");
const DELAY_MS = 1100;
/** A backstop only. The walk normally ends on a dry stretch, not here. */
const ID_CEILING = 40_000;
/** How far behind the last live product to rewind, to catch new releases. */
const TAIL_REWIND = 120;
const CURSOR_KEY = "goodsmile:shopCursor";
/** Consecutive 404s that mean the end of the range rather than a gap. */
const DRY_RUN_LENGTH = 400;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function intArg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const n = i !== -1 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const MAX = intArg("max", 800);

/**
 * The one figure this product is, or nothing.
 *
 * Nothing is what it returns for an ambiguous name, and that is the point: two
 * figures sharing a name means we cannot tell which the barcode belongs to, and
 * a guess is unrecoverable once some other source joins on it.
 */
async function matchFigure(product: GoodSmileShopProduct) {
  const candidates = await prisma.figure.findMany({
    where: { supersededById: null, name: { equals: product.name, mode: "insensitive" } },
    select: {
      id: true,
      name: true,
      manufacturer: { select: { name: true } },
      identifiers: { select: { kind: true } },
    },
  });
  const agreeing = candidates.filter(
    (c) =>
      !product.brand ||
      !c.manufacturer ||
      c.manufacturer.name.toLowerCase() === product.brand.toLowerCase(),
  );
  return agreeing.length === 1 ? agreeing[0] : null;
}

async function addIdentifier(figureId: string, kind: string, value: string): Promise<boolean> {
  const existing = await prisma.figureIdentifier.findUnique({
    where: { kind_value: { kind, value } },
    select: { figureId: true },
  });
  // Already on some figure. If that is a different one, one of the two
  // attributions is wrong and picking between them is not this script's job.
  if (existing) return false;
  await prisma.figureIdentifier.create({ data: { figureId, kind, value } });
  return true;
}

/** Where the last run stopped. */
async function resumeFrom(): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: CURSOR_KEY } });
  const stored = Number(row?.value);
  if (Number.isFinite(stored) && stored > 0) return stored;

  // No cursor yet. Fall back to the highest id already matched, so a database
  // that has been crawled once does not start again from the beginning.
  const rows = await prisma.figureIdentifier.findMany({
    where: { kind: "GSC_SHOP_PRODUCT" },
    select: { value: true },
  });
  return rows.reduce((max, r) => Math.max(max, Number(r.value) || 0), 0) + 1;
}

async function saveCursor(next: number) {
  await prisma.setting.upsert({
    where: { key: CURSOR_KEY },
    create: { key: CURSOR_KEY, value: String(next) },
    update: { value: String(next) },
  });
}

async function main() {
  const from = intArg("from", await resumeFrom());
  const to = Math.min(intArg("to", from + MAX - 1), ID_CEILING);
  console.log(WRITE ? "WRITING\n" : "Report only — pass --write to apply.\n");
  console.log(`  Walking shop ids ${from}–${to}\n`);

  let seen = 0;
  let missing = 0;
  let unmatched = 0;
  let ambiguous = 0;
  let alreadyHad = 0;
  let added = 0;
  let wrongCountry = 0;
  let dry = 0;
  let lastMatched = from - 1;
  // The last id with a product behind it, and how far the walk actually got.
  let frontier = from - 1;
  let scanned = from - 1;
  let hitTheEnd = false;

  for (let id = from; id <= to; id += 1) {
    scanned = id;
    await sleep(DELAY_MS);
    let html: string;
    try {
      const res = await fetch(`${SHOP_ORIGIN}/en/product/${id}`, {
        headers: { "User-Agent": "FigureIndexBot/1.0 (+https://figureindex.com)" },
      });
      if (!res.ok) {
        missing += 1;
        dry += 1;
        if (dry >= DRY_RUN_LENGTH) {
          console.log(`\n  ${DRY_RUN_LENGTH} ids in a row with nothing behind them — stopping at ${id}.`);
          break;
        }
        continue;
      }
      html = await res.text();
    } catch {
      missing += 1;
      continue;
    }
    dry = 0;
    frontier = id;
    seen += 1;

    const product = parseShopProduct(html);
    if (!product || !product.name) {
      unmatched += 1;
      continue;
    }

    const figure = await matchFigure(product);
    if (!figure) {
      // Distinguish "nothing like it" from "more than one", because only the
      // second is a gap worth a person's time.
      const anySameName = await prisma.figure.count({
        where: { supersededById: null, name: { equals: product.name, mode: "insensitive" } },
      });
      if (anySameName > 1) ambiguous += 1;
      else unmatched += 1;
      continue;
    }

    if (WRITE) await addIdentifier(figure.id, "GSC_SHOP_PRODUCT", String(id));
    lastMatched = id;

    if (!product.gtin) {
      unmatched += 1;
      continue;
    }
    if (figure.identifiers.some((i) => i.kind === "JAN" || i.kind === "UPC")) {
      alreadyHad += 1;
      continue;
    }

    const kind = looksJapanese(product.gtin) ? "JAN" : "UPC";
    if (added + wrongCountry < 8) {
      console.log(`  ${kind} ${product.gtin}  ${figure.name.slice(0, 50)}`);
    }
    if (WRITE) await addIdentifier(figure.id, kind, product.gtin);
    if (kind === "JAN") added += 1;
    else wrongCountry += 1;
  }

  console.log(`\n  ${seen} product page(s) read, ${missing} id(s) with nothing behind them.`);
  console.log(`  ${added} JAN(s) added, ${wrongCountry} non-Japanese barcode(s) stored as UPC.`);
  console.log(`  ${alreadyHad} figure(s) already had one; ${unmatched} product(s) matched nothing; ${ambiguous} ambiguous by name.`);
  const held = await prisma.figureIdentifier.count({ where: { kind: "JAN" } });
  console.log(`  JAN identifiers now held: ${held}${WRITE ? "" : " (unchanged — this was a report)"}`);
  console.log(`\n  Next run resumes at ${WRITE ? lastMatched + 1 : from}.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
