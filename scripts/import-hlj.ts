import "dotenv/config";
import { prisma } from "../lib/prisma";
import { slugify } from "../lib/utils";
import { USER_AGENT } from "../lib/site";
import {
  IDENTIFIER_KIND,
  isFigure,
  parseListing,
  parseProductPage,
  productUrl,
  searchUrl,
  type HljProduct,
} from "../lib/ingest/hlj";
import { decide as decideNsfw } from "../lib/ingest/nsfw";
import { findHeldProduct } from "../lib/ingest/held-product";
import { fillMissing, forgetOffer, recordOffer, staleOffers } from "../lib/ingest/shop-offer";

/**
 * Import HobbyLink Japan's catalogue.
 *
 *   npm run import:hlj                        # dry run
 *   npm run import:hlj -- --yes
 *   npm run import:hlj -- --yes --max 40 --pages 3
 *
 * Same shape as import:ninnin — refresh, attach, or create, decided on exact
 * identifiers — and it exists for what HLJ gives that the others do not.
 *
 * Every product carries a JAN, so attaching is reliable rather than
 * occasional, and each run records barcodes against figures that had none,
 * which is what makes every later source cheaper to match. Their price is in
 * yen because they are in Japan, so neither an exporter's margin nor a
 * conversion sits between us and the number. And their category is Google's
 * product taxonomy, which answers "is this a figure" far better than reading a
 * name ever did — HLJ is a model shop first, so a search for a figure line
 * returns paint, tools and plastic kits alongside it.
 *
 * The price is still a retailer's, and usually discounted. It goes to a
 * ShopOffer and never to msrpAmount, exactly as with Solaris and Nin-Nin.
 *
 * Their robots.txt allows everything but accounts and two recommendation
 * widgets, and they run an affiliate programme at hlj.com/affiliate-program.
 * Links are stored clean; tagging happens at render if a key is configured.
 */

const APPLY = process.argv.includes("--yes");
const PAGE_DELAY_MS = 1200;

/**
 * What to search for.
 *
 * There is no sitemap and no all-products category, so coverage comes from
 * searching the lines this catalogue is about rather than walking a tree that
 * is mostly model kits.
 */
const TERMS = ["nendoroid", "figma", "pop up parade", "scale figure"];

function intArg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const n = i !== -1 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const MAX = intArg("max", 60);
const PAGES = intArg("pages", 2);
/** How many of the least recently checked offers to re-read. */
const REFRESH = intArg("refresh", 40);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A page, or why there is not one.
 *
 * "gone" and "could not look" have to be told apart: the refresh below deletes
 * an offer when the product page has gone, and a network blip or a 503 must
 * never be read as the shop dropping a product.
 */
type Fetched = { html: string } | { gone: true } | { failed: true };

async function fetchPage(url: string): Promise<Fetched> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT },
      signal: controller.signal,
    });
    if (res.status === 404 || res.status === 410) return { gone: true };
    if (!res.ok) return { failed: true };
    return { html: await res.text() };
  } catch {
    return { failed: true };
  } finally {
    clearTimeout(timer);
  }
}

/** The html, or null — for the callers that do not care why. */
function htmlOf(f: Fetched): string | null {
  return "html" in f ? f.html : null;
}

/** Every product slug the searched pages link to, each one once. */
async function readListings(): Promise<string[]> {
  const slugs = new Set<string>();
  for (const term of TERMS) {
    for (let page = 1; page <= PAGES; page += 1) {
      const html = htmlOf(await fetchPage(searchUrl(term, page)));
      await sleep(PAGE_DELAY_MS);
      if (!html) continue;
      const found = parseListing(html);
      for (const s of found) slugs.add(s);
      console.log(
        `    ${term} page ${page}: ${found.length} product(s), ${slugs.size} distinct so far`,
      );
      // A page linking nothing means the term is exhausted.
      if (found.length === 0) break;
    }
  }
  return [...slugs];
}

/**
 * Their item code, read off the slug rather than fetched.
 *
 * "nendoroid-ui-gsc58608" ends in the code, so a run can tell which products
 * it already holds before spending a request on any of them.
 */
function productIdFromSlug(slug: string): string | null {
  const m = slug.match(/-([a-z]{2,4}\d{3,7})$/i);
  return m ? m[1].toUpperCase() : null;
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

async function recordIdentifiers(figureId: string, p: HljProduct) {
  const keys = [{ kind: IDENTIFIER_KIND, value: p.productId }];
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

/** Their offer, and whatever specs the figure was missing. */
async function recordAndEnrich(figureId: string, p: HljProduct): Promise<string[]> {
  await recordOffer(figureId, "HLJ", {
    url: p.url,
    priceAmount: p.priceAmount,
    priceCurrency: p.priceCurrency,
    available: p.available,
  });
  return fillMissing(figureId, {
    releaseDate: p.releaseDate,
    manufacturerId: await ensureManufacturer(p.manufacturer),
  });
}

type Outcome = "refreshed" | "attached" | "created" | "unreadable" | "skipped";

function categoryFor(p: HljProduct): string {
  const n = (p.name ?? "").toLowerCase();
  if (n.includes("nendoroid")) return "NENDOROID";
  if (n.includes("figma")) return "FIGMA";
  if (n.includes("pop up parade")) return "POP_UP_PARADE";
  if (/\b1\/\d\b/.test(n)) return "SCALE";
  return "OTHER";
}

async function slugOf(figureId: string): Promise<string | undefined> {
  const row = await prisma.figure.findUnique({ where: { id: figureId }, select: { slug: true } });
  return row?.slug;
}

async function handle(slug: string): Promise<{ outcome: Outcome; detail: string }> {
  const id = productIdFromSlug(slug);
  if (!id) return { outcome: "skipped", detail: slug.slice(0, 52) };

  const url = productUrl(slug);

  // --- Known product: refresh the offer, and stop --------------------------
  const known = await heldBy(IDENTIFIER_KIND, id);
  if (known) {
    if (APPLY) {
      const html = htmlOf(await fetchPage(url));
      await sleep(PAGE_DELAY_MS);
      const p = html ? parseProductPage(html, url) : null;
      if (p) await recordAndEnrich(known, p);
    }
    return { outcome: "refreshed", detail: slug.slice(0, 52) };
  }

  const html = htmlOf(await fetchPage(url));
  await sleep(PAGE_DELAY_MS);
  if (!html) return { outcome: "unreadable", detail: slug.slice(0, 52) };

  const product = parseProductPage(html, url);
  if (!product || !isFigure(product)) {
    return { outcome: "skipped", detail: product?.name?.slice(0, 52) ?? slug.slice(0, 52) };
  }

  // --- Their barcode against ours: the exact join --------------------------
  if (product.jan) {
    const match = await heldBy("JAN", product.jan);
    if (match) {
      let filled: string[] = [];
      if (APPLY) {
        filled = await recordAndEnrich(match, product);
        await recordIdentifiers(match, product);
      }
      return {
        outcome: "attached",
        detail:
          `JAN ${product.jan} → ${await slugOf(match)}` +
          `${filled.length ? ` +${filled.join(",")}` : ""}`,
      };
    }
  }

  if (!product.name) return { outcome: "skipped", detail: "no product name" };

  // Last check before creating. The barcode has already been tried, and most
  // of what it cannot reach is a figure imported from a source that recorded
  // no barcode at all.
  const held = await findHeldProduct({
    name: product.name,
    manufacturer: product.manufacturer,
    category: categoryFor(product),
  });
  if (held) {
    let filled: string[] = [];
    if (APPLY) {
      filled = await recordAndEnrich(held.id, product);
      await recordIdentifiers(held.id, product);
    }
    return {
      outcome: "attached",
      detail:
        `same product as ${held.name.slice(0, 36)}` +
        `${filled.length ? ` +${filled.join(",")}` : ""}`,
    };
  }

  if (!APPLY) return { outcome: "created", detail: product.name.slice(0, 52) };

  const base = slugify(product.name);
  let figureSlug = base;
  for (let n = 2; n < 50; n += 1) {
    if (!(await prisma.figure.findUnique({ where: { slug: figureSlug }, select: { id: true } }))) {
      break;
    }
    figureSlug = `${base}-${n}`;
  }

  const figure = await prisma.figure.create({
    data: {
      name: product.name,
      slug: figureSlug,
      category: categoryFor(product) as never,
      status: (product.releaseDate && product.releaseDate.getTime() > Date.now()
        ? "PREORDER"
        : "RELEASED") as never,
      releaseDate: product.releaseDate,
      // They state a full date, unlike the archive's month, so the precision
      // says day and markReleased can act on it exactly.
      releaseDatePrecision: product.releaseDate ? "DAY" : "MONTH",
      manufacturerId: await ensureManufacturer(product.manufacturer),

      // No MSRP. Their price is a retailer's and usually discounted, so
      // claiming it as the manufacturer's would be a different and
      // unsupported claim.
      ...(() => {
        const verdict = decideNsfw({ name: product.name! });
        return verdict ? { nsfw: verdict.nsfw, nsfwSource: verdict.source } : {};
      })(),
    },
    select: { id: true, slug: true },
  });

  await recordOffer(figure.id, "HLJ", {
    url: product.url,
    priceAmount: product.priceAmount,
    priceCurrency: product.priceCurrency,
    available: product.available,
  });
  await recordIdentifiers(figure.id, product);
  return { outcome: "created", detail: figure.slug };
}

/**
 * Re-read the offers the listing walk did not reach.
 *
 * The walk only ever sees what the shop chooses to show: four searches, two
 * pages each, about 190 products. Everything imported before that window moved
 * on would otherwise keep publishing whatever price and stock it had on the day
 * it was found, with nothing on the page saying how old that is.
 *
 * Oldest first, so the queue drains evenly rather than re-reading the same
 * products every night, and skipping what this run has already handled.
 */
async function refreshStale(alreadyDone: readonly string[]): Promise<{
  checked: number;
  changed: number;
  gone: number;
  unreachable: number;
}> {
  const due = await staleOffers("HLJ", REFRESH, alreadyDone);
  let changed = 0;
  let gone = 0;
  let unreachable = 0;

  for (const offer of due) {
    const fetched = await fetchPage(offer.url);
    await sleep(PAGE_DELAY_MS);

    if ("gone" in fetched) {
      // They told us the product is not there. That is a fact about the shop,
      // unlike a timeout, so the offer goes.
      gone += 1;
      if (APPLY) await forgetOffer(offer.id);
      console.log(`  gone       ${offer.url.slice(-52)}`);
      continue;
    }
    if ("failed" in fetched) {
      unreachable += 1;
      continue;
    }

    const product = parseProductPage(fetched.html, offer.url);
    if (!product) {
      unreachable += 1;
      continue;
    }
    if (APPLY) await recordAndEnrich(offer.figureId, product);
    changed += 1;
  }

  return { checked: due.length, changed, gone, unreachable };
}

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "postgres://unset").hostname;
  console.log(`\n  ${APPLY ? "Writing to" : "Dry run against"} ${host}`);
  console.log(
    `  Searching ${TERMS.length} term(s) over ${PAGES} page(s), importing at most ${MAX} new one(s)\n`,
  );

  const slugs = await readListings();
  if (slugs.length === 0) {
    console.log("\n  No products found — the listing markup may have changed.\n");
    await prisma.$disconnect();
    return;
  }

  const ids = slugs.map(productIdFromSlug).filter((v): v is string => Boolean(v));
  const knownIds = new Set(
    (
      await prisma.figureIdentifier.findMany({
        where: { kind: IDENTIFIER_KIND, value: { in: ids } },
        select: { value: true },
      })
    ).map((r) => r.value),
  );
  const known = slugs.filter((s) => knownIds.has(productIdFromSlug(s)!));
  const fresh = slugs.filter((s) => !knownIds.has(productIdFromSlug(s)!));
  const batch = [...known, ...fresh.slice(0, MAX)];

  console.log(`\n  ${slugs.length} product(s) linked`);
  console.log(`    ${known.length} already imported — refreshing price and stock`);
  console.log(`    ${fresh.length} not yet held, taking ${Math.min(MAX, fresh.length)}\n`);

  const tally: Record<Outcome, number> = {
    refreshed: 0,
    attached: 0,
    created: 0,
    unreadable: 0,
    skipped: 0,
  };

  for (const slug of batch) {
    const { outcome, detail } = await handle(slug);
    tally[outcome] += 1;
    if (outcome !== "refreshed") console.log(`  ${outcome.padEnd(10)} ${detail}`);
  }

  console.log(
    `\n  refreshed ${tally.refreshed}  attached ${tally.attached}  created ${tally.created}` +
      `  unreadable ${tally.unreadable}  skipped ${tally.skipped}`,
  );

  // Then the ones the walk could not see.
  const walked = batch.map((slug) => productUrl(slug));
  const stale = await refreshStale(walked);
  console.log(
    `  re-read ${stale.checked} stale offer(s): ${stale.changed} updated, ` +
      `${stale.gone} no longer sold, ${stale.unreachable} unreachable`,
  );
  if (!APPLY) console.log("  Dry run — pass --yes to write.\n");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
