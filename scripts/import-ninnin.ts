import "dotenv/config";
import { prisma } from "../lib/prisma";
import { slugify } from "../lib/utils";
import { USER_AGENT } from "../lib/site";
import {
  LISTING_PAGES,
  STORE_ORIGIN,
  categoryFor,
  isFigure,
  parseProductPage,
  productIdFromUrl,
  productLinks,
  type NinNinProduct,
} from "../lib/ingest/ninnin";
import { decide as decideNsfw } from "../lib/ingest/nsfw";
import { findHeldProduct } from "../lib/ingest/held-product";
import { fillMissing, recordOffer } from "../lib/ingest/shop-offer";

/**
 * Import Nin-Nin Game's catalogue.
 *
 *   npm run import:ninnin                  # dry run
 *   npm run import:ninnin -- --yes
 *   npm run import:ninnin -- --max 40
 *
 * Same shape as import:solaris — refresh, attach, or create, decided on exact
 * identifiers — with two differences that come from the shop rather than from
 * preference.
 *
 * The first is good: every product page carries `gtin13`, the JAN. That is the
 * exact key this catalogue joins on, so attaching is reliable here in a way it
 * is not for a source that only sometimes states a barcode. It also means each
 * import records barcodes against figures that had none, which is the thing
 * that makes *every* later source easier to match.
 *
 * The second is a constraint: their robots.txt disallows `/*?p=`, PrestaShop's
 * pagination parameter, so no listing can be read past its first page. Coverage
 * comes from reading many category pages, 48 products each, not from paging.
 *
 * Store links are only written to a figure that has none. Nin-Nin run no
 * affiliate programme — they say so on their wholesale page — so overwriting a
 * Solaris link, which is tagged and earns, with one that cannot would quietly
 * cost money on every figure both shops happen to stock.
 */

const APPLY = process.argv.includes("--yes");
const PAGE_DELAY_MS = 900;

function intArg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const n = i !== -1 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const MAX = intArg("max", 60);

type Outcome = "refreshed" | "attached" | "created" | "unreadable" | "skipped";

async function fetchPage(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Every product the seeded listings link to, each one once. */
async function readListings(): Promise<string[]> {
  const urls = new Set<string>();
  for (const path of LISTING_PAGES) {
    const html = await fetchPage(`${STORE_ORIGIN}${path}`);
    if (html) for (const url of productLinks(html)) urls.add(url);
    process.stdout.write(`\r  read ${path.padEnd(44)} ${urls.size} product(s) so far`);
    await new Promise((r) => setTimeout(r, 500));
  }
  process.stdout.write("\n");
  return [...urls];
}

function storeFields(p: NinNinProduct) {
  return {
    storeUrl: p.url,
    storePriceAmount: p.priceAmount,
    storePriceCurrency: p.priceAmount === null ? null : p.priceCurrency,
    storeAvailable: p.available,
    storeClosesAt: null,
    storeCheckedAt: new Date(),
  };
}

async function ensureManufacturer(name: string | null): Promise<string | null> {
  const clean = name?.trim();
  if (!clean) return null;

  const existing = await prisma.manufacturer.findFirst({
    where: { name: { equals: clean, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) return existing.id;

  const base = slugify(clean);
  let slug = base;
  for (let n = 2; n < 50; n += 1) {
    if (!(await prisma.manufacturer.findUnique({ where: { slug } }))) break;
    slug = `${base}-${n}`;
  }
  return (await prisma.manufacturer.create({ data: { name: clean, slug } })).id;
}

async function recordIdentifiers(figureId: string, p: NinNinProduct) {
  const keys = [{ kind: "NINNIN_PRODUCT", value: p.productId }];
  if (p.jan) keys.push({ kind: "JAN", value: p.jan });
  for (const key of keys) {
    await prisma.figureIdentifier.upsert({
      where: { kind_value: key },
      create: { figureId, ...key },
      update: {},
    });
  }
}

async function heldBy(kind: string, value: string): Promise<string | null> {
  const row = await prisma.figureIdentifier.findUnique({
    where: { kind_value: { kind, value } },
    select: { figureId: true },
  });
  return row?.figureId ?? null;
}

/**
 * Write the shop link only where there is not already one.
 *
 * A figure carries a single store link, and the one already on it may be a
 * tagged Solaris or Kotobukiya URL that earns. Replacing that with a link that
 * cannot earn is a silent loss, so the rule is: fill a gap, refresh our own,
 * never displace somebody else's.
 */
async function writeStore(figureId: string, p: NinNinProduct): Promise<boolean> {
  const current = await prisma.figure.findUnique({
    where: { id: figureId },
    select: { storeUrl: true },
  });
  const held = current?.storeUrl ?? null;
  if (held && !held.startsWith(STORE_ORIGIN)) return false;
  await prisma.figure.update({ where: { id: figureId }, data: storeFields(p) });
  return true;
}

/**
 * Their offer, and whatever specs the figure was missing.
 *
 * Separate from writeStore above, and unconditional where that is not. The
 * figure-level store fields are one slot shared by every importer, so
 * writeStore politely declines when another shop got there first -- which
 * meant this shop's price and link were simply discarded. The offer row is
 * ours alone and is always written.
 */
async function recordAndEnrich(figureId: string, p: NinNinProduct): Promise<string[]> {
  await recordOffer(figureId, "NINNIN", {
    url: p.url,
    priceAmount: p.priceAmount,
    priceCurrency: p.priceCurrency,
    available: p.available,
  });
  return fillMissing(figureId, {
    scale: p.scale,
    heightMm: p.heightMm,
    releaseDate: p.releaseDate,
    manufacturerId: await ensureManufacturer(p.manufacturer),
  });
}

async function handle(url: string): Promise<{ outcome: Outcome; detail: string }> {
  const productId = productIdFromUrl(url);
  if (!productId) return { outcome: "skipped", detail: url.slice(-52) };

  // --- Known product: refresh price and stock, no page fetch ---------------
  const known = await heldBy("NINNIN_PRODUCT", productId);
  if (known) {
    if (APPLY) {
      const fresh = await fetchPage(url);
      await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
      const p = fresh ? parseProductPage(fresh, url) : null;
      if (p) {
        await writeStore(known, p);
        await recordAndEnrich(known, p);
      }
    }
    return { outcome: "refreshed", detail: url.slice(-52) };
  }

  const html = await fetchPage(url);
  await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  if (!html) return { outcome: "unreadable", detail: url.slice(-52) };

  const product = parseProductPage(html, url);
  if (!product || !isFigure(product)) {
    return { outcome: "skipped", detail: product?.name?.slice(0, 52) ?? url.slice(-52) };
  }

  // --- Their barcode against ours: the exact join ---------------------------
  if (product.jan) {
    const match = await heldBy("JAN", product.jan);
    if (match) {
      let linked = false;
      let filled: string[] = [];
      if (APPLY) {
        linked = await writeStore(match, product);
        filled = await recordAndEnrich(match, product);
        await recordIdentifiers(match, product);
      }
      const slug = (await prisma.figure.findUnique({ where: { id: match }, select: { slug: true } }))?.slug;
      return {
        outcome: "attached",
        detail:
          `JAN ${product.jan} → ${slug}` +
          `${filled.length ? ` +${filled.join(",")}` : ""}` +
          `${APPLY && !linked ? " (kept its existing shop link)" : ""}`,
      };
    }
  }

  if (!product.name) return { outcome: "skipped", detail: "no product name" };

  // Last check before creating. Their barcode has already been tried, and most
  // of what it cannot reach is scale figures holding no identifier at all.
  const held = await findHeldProduct({
    name: product.name,
    manufacturer: product.manufacturer,
    category: categoryFor(product),
  });
  if (held) {
    let linked = false;
    let filled: string[] = [];
    if (APPLY) {
      linked = await writeStore(held.id, product);
      filled = await recordAndEnrich(held.id, product);
      await recordIdentifiers(held.id, product);
    }
    return {
      outcome: "attached",
      detail:
        `same product as ${held.name.slice(0, 36)}` +
        `${filled.length ? ` +${filled.join(",")}` : ""}` +
        `${APPLY && !linked ? " (kept its shop link)" : ""}`,
    };
  }

  if (!APPLY) return { outcome: "created", detail: product.name.slice(0, 52) };

  const base = slugify(product.name);
  let slug = base;
  for (let n = 2; n < 50; n += 1) {
    if (!(await prisma.figure.findUnique({ where: { slug }, select: { id: true } }))) break;
    slug = `${base}-${n}`;
  }

  const figure = await prisma.figure.create({
    data: {
      name: product.name,
      slug,
      category: categoryFor(product) as never,
      status: (product.releaseDate && product.releaseDate.getTime() > Date.now()
        ? "PREORDER"
        : "RELEASED") as never,
      releaseDate: product.releaseDate,
      // They state a month, never a day, so the precision says month.
      releaseDatePrecision: "MONTH",
      scale: product.scale,
      heightMm: product.heightMm,
      manufacturerId: await ensureManufacturer(product.manufacturer),

      // No MSRP. Their price is a reseller's, in whichever currency their
      // storefront served us, and claiming it as the manufacturer's would be
      // a different and unsupported claim.
      ...storeFields(product),

      // They publish no content rating, unlike Solaris, so this is read off
      // the name — the weaker of the two signals, and the only one here.
      ...(() => {
        const verdict = decideNsfw({ name: product.name! });
        return verdict ? { nsfw: verdict.nsfw, nsfwSource: verdict.source } : {};
      })(),
    },
    select: { id: true, slug: true },
  });

  await recordOffer(figure.id, "NINNIN", {
    url: product.url,
    priceAmount: product.priceAmount,
    priceCurrency: product.priceCurrency,
    available: product.available,
  });
  await recordIdentifiers(figure.id, product);
  return { outcome: "created", detail: figure.slug };
}

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "postgres://unset").hostname;
  console.log(`\n  ${APPLY ? "Writing to" : "Dry run against"} ${host}`);
  console.log(`  Reading ${LISTING_PAGES.length} listing page(s), importing at most ${MAX} new one(s)\n`);

  const urls = await readListings();
  if (urls.length === 0) {
    console.log("\n  No products found — the listing markup may have changed.\n");
    await prisma.$disconnect();
    return;
  }

  const ids = urls.map((u) => productIdFromUrl(u)).filter((v): v is string => Boolean(v));
  const knownIds = new Set(
    (
      await prisma.figureIdentifier.findMany({
        where: { kind: "NINNIN_PRODUCT", value: { in: ids } },
        select: { value: true },
      })
    ).map((r) => r.value),
  );
  const known = urls.filter((u) => knownIds.has(productIdFromUrl(u)!));
  const fresh = urls.filter((u) => !knownIds.has(productIdFromUrl(u)!));
  const batch = [...known, ...fresh.slice(0, MAX)];

  console.log(`\n  ${urls.length} product(s) linked`);
  console.log(`    ${known.length} already imported — refreshing price and stock`);
  console.log(`    ${fresh.length} not yet held, taking ${Math.min(MAX, fresh.length)}\n`);

  const tally: Record<Outcome, number> = {
    refreshed: 0,
    attached: 0,
    created: 0,
    unreadable: 0,
    skipped: 0,
  };
  for (const url of batch) {
    const { outcome, detail } = await handle(url);
    tally[outcome] += 1;
    if (outcome !== "refreshed") console.log(`  ${outcome.padEnd(10)} ${detail}`);
  }

  console.log(
    `\n  refreshed ${tally.refreshed}  attached ${tally.attached}  created ${tally.created}` +
      `  unreadable ${tally.unreadable}  skipped ${tally.skipped}`,
  );
  if (!APPLY) console.log("\n  Dry run. Re-run with --yes to apply.");
  console.log("");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
