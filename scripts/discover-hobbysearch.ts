import "dotenv/config";
import { prisma } from "../lib/prisma";
import { USER_AGENT } from "../lib/site";
import {
  CATEGORIES,
  listingUrl,
  parseListing,
  parseProductPage,
  productUrl,
  type HobbySearchProduct,
} from "../lib/ingest/hobbysearch";

/**
 * Walk HobbySearch a slice at a time, adding figures the catalogue lacks.
 *
 *   npm run discover:hobbysearch                    # dry run
 *   npm run discover:hobbysearch -- --yes
 *   npm run discover:hobbysearch -- --category 605 --page 3
 *
 * A rotation rather than a sweep. Each run reads part of one page of one
 * category and the slice advances by itself, so the whole store is covered over
 * weeks without ever asking for much at once. They rate-limit, and hard: see
 * REQUEST_DELAY_MS for what happened when this was impatient.
 *
 * Unlike the other sources, this one creates figures directly rather than
 * queueing candidates. It can, because it has what the queue exists to
 * establish: a JAN barcode to prove the figure is not already listed, and the
 * manufacturer's own list price rather than a shop's marked-up one. A candidate
 * queue is for evidence that needs a human to weigh; a barcode does not.
 *
 * Anything without a JAN is skipped rather than guessed at. That is the whole
 * safety property here, and it costs only the products their data is thin on.
 */

const APPLY = process.argv.includes("--yes");

/**
 * How long to wait between requests.
 *
 * This number no longer decides anything, and the reasoning that produced it
 * was wrong. It was set to sixty seconds on the theory that the 403s were rate
 * limiting — their robots.txt asks several named crawlers to wait that long,
 * and the refusals moved around in a way that looked like an allowance being
 * tripped.
 *
 * They are not rate limiting. The response is a Cloudflare challenge page:
 * `server: cloudflare`, a cf-ray header, and "Just a moment..." in the body.
 * It arrives on the first request of the night, twenty-four hours after the
 * last one, which no rate limiter would do.
 *
 * Proof it is the client rather than the address: curl fetches the same URL
 * from the same machine, seconds apart, and gets 200 with 411KB of HTML. What
 * Cloudflare refuses is this process — its TLS handshake, not its manners.
 *
 * Left at sixty because if access is ever restored it is the right neighbourly
 * default for a rotation that has weeks to finish.
 */
const REQUEST_DELAY_MS = Number(process.env.HOBBYSEARCH_DELAY_MS ?? "60000");

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? (process.argv[i + 1] ?? null) : null;
}

/** Products read per run. Ten at a minute apart; the rotation has weeks. */
const LIMIT = Number(arg("limit") ?? "10") || 10;

/**
 * Which slice this run reads.
 *
 * Derived from the date so consecutive nights advance without storing a cursor
 * anywhere. Deterministic, so a re-run on the same day reads the same slice
 * and finds it already imported rather than doing something different.
 */
function slice(pagesPerCategory: number): { category: (typeof CATEGORIES)[number]; page: number } {
  const day = Math.floor(Date.now() / 86_400_000);
  const total = CATEGORIES.length * pagesPerCategory;
  const step = day % total;
  return {
    category: CATEGORIES[step % CATEGORIES.length],
    page: Math.floor(step / CATEGORIES.length) + 1,
  };
}

/** Distinguishes "they refused" from "it is not there", which need different responses. */
type Fetched = { html: string } | { refused: true } | { missing: true };

async function fetchPage(url: string): Promise<Fetched> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: controller.signal });
    // 403 here is a Cloudflare challenge, not a missing page and not a rate
    // limit. Stopping is still the right response: there is nothing to retry
    // into and nothing this process can honestly do about it.
    // stopping is the only correct answer; retrying harder is how a source
    // stops being available at all.
    if (res.status === 403 || res.status === 429) return { refused: true };
    if (!res.ok) return { missing: true };
    return { html: await res.text() };
  } catch {
    return { missing: true };
  } finally {
    clearTimeout(timer);
  }
}

async function ensureManufacturer(name: string | null): Promise<string | null> {
  const clean = name?.trim();
  if (!clean) return null;

  const existing = await prisma.manufacturer.findFirst({
    where: { name: { equals: clean, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) return existing.id;

  const base = clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  let slug = base || "unknown";
  for (let n = 2; n < 50; n += 1) {
    if (!(await prisma.manufacturer.findUnique({ where: { slug } }))) break;
    slug = `${base}-${n}`;
  }
  return (await prisma.manufacturer.create({ data: { name: clean, slug } })).id;
}

function slugify(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

type Outcome = "created" | "held" | "no-jan" | "unreadable";

async function handle(product: HobbySearchProduct): Promise<Outcome> {
  if (!product.jan) return "no-jan";

  const held = await prisma.figureIdentifier.findUnique({
    where: { kind_value: { kind: "JAN", value: product.jan } },
    select: { figureId: true },
  });
  if (held) {
    if (APPLY && product.listPriceJpy) {
      // Already listed, but this source knows the maker's price and the one we
      // hold may have come from a retailer. Only fills a gap; never overwrites.
      await prisma.figure.updateMany({
        where: { id: held.figureId, msrpAmount: null },
        data: { msrpAmount: product.listPriceJpy, msrpCurrency: "JPY" },
      });
    }
    return "held";
  }

  if (!APPLY) return "created";

  const base = slugify(product.name);
  let slug = base || `hobbysearch-${product.productId}`;
  for (let n = 2; n < 50; n += 1) {
    if (!(await prisma.figure.findUnique({ where: { slug }, select: { id: true } }))) break;
    slug = `${base}-${n}`;
  }

  await prisma.figure.create({
    data: {
      name: product.name,
      slug,
      status: (product.releaseDate && product.releaseDate.getTime() > Date.now()
        ? "PREORDER"
        : "RELEASED") as never,
      releaseDate: product.releaseDate,
      // They publish thirds of a month — "Late Jan 2027" — so the date means a
      // month and the MSRP converts at the month's average rate.
      releaseDatePrecision: "MONTH",
      // The manufacturer's list price, in yen, consistent with the rest of the
      // catalogue. This is the reason this source exists.
      msrpAmount: product.listPriceJpy,
      msrpCurrency: product.listPriceJpy ? "JPY" : null,
      manufacturerId: await ensureManufacturer(product.maker),

      // A retailer's link and a retailer's price, kept apart from MSRP.
      storeUrl: product.url,
      storePriceAmount: product.salesPriceJpy,
      storePriceCurrency: product.salesPriceJpy ? "JPY" : null,
      storeCheckedAt: new Date(),

      identifiers: { create: { kind: "JAN", value: product.jan } },
    },
  });
  return "created";
}

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "postgres://unset").hostname;
  const pagesPerCategory = Number(arg("pages") ?? "6") || 6;
  const chosen = slice(pagesPerCategory);
  const categoryId = arg("category") ?? chosen.category.id;
  const page = Number(arg("page") ?? chosen.page) || chosen.page;
  const label = CATEGORIES.find((c) => c.id === categoryId)?.label ?? categoryId;

  console.log(`\n  ${APPLY ? "Writing to" : "Dry run against"} ${host}`);
  console.log(`  Reading ${label}, page ${page}\n`);

  const listing = await fetchPage(listingUrl(categoryId, page));
  if ("refused" in listing) {
    console.log("  They asked us to slow down. Stopping — nothing was read.\n");
    await prisma.$disconnect();
    return;
  }
  if ("missing" in listing) throw new Error(`could not read ${listingUrl(categoryId, page)}`);

  const all = parseListing(listing.html);
  const ids = all.slice(0, LIMIT);
  console.log(`  ${all.length} product(s) on the page, reading ${ids.length}`);
  if (ids.length === 0) {
    console.log("  Nothing to do — past the end of this category.\n");
    await prisma.$disconnect();
    return;
  }

  const tally: Record<Outcome, number> = { created: 0, held: 0, "no-jan": 0, unreadable: 0 };
  const created: string[] = [];

  for (const id of ids) {
    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    const fetched = await fetchPage(productUrl(id));
    if ("refused" in fetched) {
      // Stop the run rather than finish it. Everything read so far is already
      // written, and the rotation picks up from a fresh slice tomorrow.
      console.log("\n  They asked us to slow down. Stopping here.");
      break;
    }
    if ("missing" in fetched) {
      tally.unreadable += 1;
      continue;
    }
    const product = parseProductPage(fetched.html, id);
    if (!product) {
      tally.unreadable += 1;
      continue;
    }
    const outcome = await handle(product);
    tally[outcome] += 1;
    if (outcome === "created") {
      created.push(
        `${(product.maker ?? "—").slice(0, 18).padEnd(18)} ${String(product.listPriceJpy ?? "—").padStart(7)} JPY  ${product.name.slice(0, 44)}`,
      );
    }
  }

  console.log(`\n  created ${tally.created}  already held ${tally.held}  no barcode ${tally["no-jan"]}  unreadable ${tally.unreadable}`);
  if (created.length > 0) {
    console.log("\n  new:");
    for (const line of created.slice(0, 12)) console.log(`    ${line}`);
    if (created.length > 12) console.log(`    … and ${created.length - 12} more`);
  }
  if (!APPLY) console.log("\n  Dry run. Re-run with --yes to import.");
  console.log("");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
