import "dotenv/config";
import { prisma } from "../lib/prisma";
import { slugify } from "../lib/utils";
import { USER_AGENT } from "../lib/site";
import {
  STORE_ORIGIN,
  candidateKey,
  classify,
  type SolarisCandidate,
} from "../lib/ingest/solaris";
import { parseProductPage, tidyName, type SolarisSpecs } from "../lib/ingest/solaris-product";
import { decide as decideNsfw, fromRetailerTags as nsfwFromTags } from "../lib/ingest/nsfw";

/**
 * Import Solaris Japan's catalogue directly.
 *
 *   npm run import:solaris                  # dry run
 *   npm run import:solaris -- --yes
 *   npm run import:solaris -- --max 40
 *   npm run import:solaris -- --include-gsc
 *
 * This replaces discover:solaris plus process:candidates, which between them
 * routed every Solaris product through a review queue. The queue did not work:
 * 27 products a night were parked as "left for review" and none was ever looked
 * at again — not one candidate had been touched after first sight. A queue that
 * only grows is not review, it is deletion with extra steps, and the products
 * it held were simply lost.
 *
 * Three outcomes, decided on the spot:
 *
 *   refreshed  we already know this product. Its price and stock are updated,
 *              and no page is fetched, because nothing else we store can have
 *              changed.
 *   attached   its barcode or release number belongs to a figure we hold. That
 *              figure gains the shop link it was missing.
 *   created    nothing matches it. Created with the real specs and the link.
 *
 * What makes dropping the queue safe is the SOLARIS_PRODUCT identifier. Every
 * figure this touches records the retailer's product id, so tomorrow's run
 * resolves the same product to the same figure instead of creating it again.
 * Without that, a straight import would duplicate its whole intake nightly.
 *
 * It deliberately does not reproduce the old fuzzy "looks like something we
 * already have" check. That compared a character name and a product line, and
 * in one night blocked three different Miku Nendoroids for resembling a single
 * reissue. Exact identifiers decide here; a name that merely rhymes does not.
 */

const APPLY = process.argv.includes("--yes");
const INCLUDE_GSC = process.argv.includes("--include-gsc");
const PAGE_DELAY_MS = 900;

function intArg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const n = i !== -1 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const MAX = intArg("max", 60);
const PAGES = intArg("pages", 8);

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

async function readCatalogue() {
  const kept: SolarisCandidate[] = [];
  const skipped = new Map<string, number>();

  for (let page = 1; page <= PAGES; page += 1) {
    const res = await fetch(`${STORE_ORIGIN}/products.json?limit=250&page=${page}`, {
      headers: { "user-agent": USER_AGENT },
    });
    if (!res.ok) throw new Error(`product index returned ${res.status} on page ${page}`);

    const products = (await res.json()).products ?? [];
    if (products.length === 0) break;

    for (const product of products) {
      const verdict = classify(product, { includeGoodSmile: INCLUDE_GSC });
      if (verdict.ok) kept.push(verdict.candidate);
      else skipped.set(verdict.reason, (skipped.get(verdict.reason) ?? 0) + 1);
    }

    process.stdout.write(`\r  read ${page} page(s), ${kept.length} figures kept`);
    if (products.length < 250) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  process.stdout.write("\n");
  return { kept, skipped };
}

/** What the shop currently says, written the same way whatever the outcome. */
function storeFields(c: SolarisCandidate) {
  return {
    // The clean URL. Affiliate tagging happens when the page renders, so the id
    // lives in one environment variable rather than baked into thousands of
    // rows that would all need rewriting if it ever changed.
    storeUrl: c.url,
    storePriceAmount: c.priceUsd,
    storePriceCurrency: c.priceUsd === null ? null : "USD",
    storeAvailable: c.available,
    // No order window is published anywhere on their pages.
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

/** Their type wording, mapped only where it is unambiguous. */
function categoryFor(specs: SolarisSpecs): string {
  const t = (specs.type ?? "").toLowerCase();
  if (t.includes("nendoroid")) return "NENDOROID";
  if (t.includes("figma")) return "FIGMA";
  if (t.includes("plush")) return "PLUSH";
  if (t.includes("model kit") || t.includes("plastic model")) return "MODEL_KIT";
  if (t.includes("trading")) return "TRADING";
  if (t.includes("prize")) return "PRIZE";
  if (specs.scale) return "SCALE";
  // Not guessed from words in a retailer's title. A moderator can set it; a
  // wrong category nobody knows is a guess cannot be corrected.
  return "OTHER";
}

/** Record every identifier we learned, without disturbing one already held. */
async function recordIdentifiers(figureId: string, c: SolarisCandidate, jan: string | null) {
  const keys: { kind: string; value: string }[] = [
    { kind: "SOLARIS_PRODUCT", value: c.productId },
  ];
  if (jan) keys.push({ kind: "JAN", value: jan });
  if (c.line && c.number) {
    keys.push({ kind: c.line === "FIGMA" ? "FIGMA_NO" : "NENDOROID_NO", value: c.number });
  }
  for (const key of keys) {
    await prisma.figureIdentifier.upsert({
      where: { kind_value: key },
      create: { figureId, ...key },
      update: {},
    });
  }
}

/**
 * Settle any queue entry this product left behind.
 *
 * The old pipeline queued 196 of these before it was replaced. Resolving one
 * here is the very event the queue was waiting for, so the row is closed rather
 * than left looking outstanding for good.
 */
async function closeStaleCandidate(productId: string, figureId: string) {
  await prisma.figureCandidate.updateMany({
    where: { key: candidateKey(productId), status: "OPEN" },
    data: { status: "ACCEPTED", figureId, reviewedAt: new Date() },
  });
}

async function heldBy(kind: string, value: string): Promise<string | null> {
  const row = await prisma.figureIdentifier.findUnique({
    where: { kind_value: { kind, value } },
    select: { figureId: true },
  });
  return row?.figureId ?? null;
}

/** Whether a figure already carries a barcode, in either flavour. */
async function hasBarcode(figureId: string): Promise<boolean> {
  return Boolean(
    await prisma.figureIdentifier.findFirst({
      where: { figureId, kind: { in: ["JAN", "UPC"] } },
      select: { id: true },
    }),
  );
}

async function slugOf(id: string): Promise<string> {
  const row = await prisma.figure.findUnique({ where: { id }, select: { slug: true } });
  return row?.slug ?? id;
}

async function attach(
  figureId: string,
  c: SolarisCandidate,
  jan: string | null,
  how: string,
): Promise<{ outcome: Outcome; detail: string }> {
  if (APPLY) {
    await prisma.figure.update({ where: { id: figureId }, data: storeFields(c) });
    await recordIdentifiers(figureId, c, jan);
    await closeStaleCandidate(c.productId, figureId);
  }
  return { outcome: "attached", detail: `${how} → ${await slugOf(figureId)}` };
}

async function handle(c: SolarisCandidate): Promise<{ outcome: Outcome; detail: string }> {
  // --- Known product: refresh what the shop says, and stop -----------------
  const known = await heldBy("SOLARIS_PRODUCT", c.productId);
  if (known) {
    if (APPLY) {
      await prisma.figure.update({ where: { id: known }, data: storeFields(c) });
      // Barcode too, if it still has none. A figure imported before this
      // script recorded barcodes would otherwise never get one: every later
      // run recognises the product and stops here, so "known" quietly meant
      // "never looked at again".
      if (!(await hasBarcode(known))) {
        const html = await fetchPage(c.url);
        await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
        const jan = html ? parseProductPage(html).jan : null;
        if (jan) {
          await recordIdentifiers(known, c, jan);
          return { outcome: "attached", detail: `+JAN ${jan} → ${await slugOf(known)}` };
        }
      }
    }
    return { outcome: "refreshed", detail: c.title.slice(0, 58) };
  }

  // --- Release number: exact, and usually costs no page fetch --------------
  if (c.line && c.number) {
    const kind = c.line === "FIGMA" ? "FIGMA_NO" : "NENDOROID_NO";
    const match = await heldBy(kind, c.number);
    if (match) {
      // One exception to skipping the fetch: if the figure has no barcode, the
      // page we are declining to read is carrying one. This used to pass null
      // and move on, so every attach by release number threw a JAN away — and
      // a barcode is the identifier that means the same thing to every shop,
      // which is what makes the *next* source cheap to match.
      let jan: string | null = null;
      if (!(await hasBarcode(match))) {
        const html = await fetchPage(c.url);
        await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
        jan = html ? parseProductPage(html).jan : null;
      }
      return attach(match, c, jan, `${c.line} #${c.number}${jan ? ` +JAN ${jan}` : ""}`);
    }
  }

  // --- Everything else needs the product page ------------------------------
  const html = await fetchPage(c.url);
  await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  if (!html) return { outcome: "unreadable", detail: c.title.slice(0, 58) };

  const specs = parseProductPage(html);

  if (specs.jan) {
    const match = await heldBy("JAN", specs.jan);
    if (match) return attach(match, c, specs.jan, `JAN ${specs.jan}`);
  }

  if (!specs.name) return { outcome: "skipped", detail: "no product name on the page" };

  const name = tidyName(specs.name);
  if (!APPLY) return { outcome: "created", detail: name.slice(0, 58) };

  const base = slugify(name);
  let slug = base;
  for (let n = 2; n < 50; n += 1) {
    if (!(await prisma.figure.findUnique({ where: { slug }, select: { id: true } }))) break;
    slug = `${base}-${n}`;
  }

  const tagVerdict = nsfwFromTags(c.tags, "solaris");
  const figure = await prisma.figure.create({
    data: {
      name,
      slug,
      category: categoryFor(specs) as never,
      status: (specs.releaseDate && specs.releaseDate.getTime() > Date.now()
        ? "PREORDER"
        : "RELEASED") as never,
      releaseDate: specs.releaseDate,
      // Their pages state a full date, unlike every other source here, so the
      // MSRP conversion may use that day's published rate rather than the
      // month's average.
      releaseDatePrecision: specs.releaseDate ? "DAY" : "MONTH",
      scale: specs.scale,
      heightMm: specs.heightMm,
      manufacturerId: await ensureManufacturer(specs.manufacturer ?? c.vendor),

      // No MSRP. Solaris is a retailer and their price carries an exporter's
      // margin — 12–26% over the manufacturer's price on figures we can check.
      // The link and its asking price say what they charge; msrpAmount would
      // claim something about the manufacturer this source cannot support.
      ...storeFields(c),

      // The retailer classifies every figure they list, which is a better
      // signal than anything we could read off a name; only fall back to
      // reading the name when they did not. See lib/ingest/nsfw.ts.
      ...(() => {
        const verdict = tagVerdict ?? decideNsfw({ name });
        if (!verdict) return {};
        return { nsfw: verdict.nsfw, nsfwSource: tagVerdict ? "solaris" : verdict.source };
      })(),
    },
    select: { id: true, slug: true },
  });

  await recordIdentifiers(figure.id, c, specs.jan);
  await closeStaleCandidate(c.productId, figure.id);
  return { outcome: "created", detail: figure.slug };
}

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "postgres://unset").hostname;
  console.log(`\n  ${APPLY ? "Writing to" : "Dry run against"} ${host}`);
  console.log(`  Reading up to ${PAGES} page(s), importing at most ${MAX} new one(s)\n`);

  const { kept, skipped } = await readCatalogue();

  console.log("\n  skipped:");
  for (const [reason, n] of [...skipped].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
    console.log(`    ${String(n).padStart(5)}  ${reason}`);
  }

  // Products already imported come first: they cost one price update each and
  // no page fetch, so a capped run still keeps the shop data current before
  // spending its budget on new ones.
  const knownIds = new Set(
    (
      await prisma.figureIdentifier.findMany({
        where: { kind: "SOLARIS_PRODUCT", value: { in: kept.map((c) => c.productId) } },
        select: { value: true },
      })
    ).map((r) => r.value),
  );
  const known = kept.filter((c) => knownIds.has(c.productId));
  const fresh = kept.filter((c) => !knownIds.has(c.productId));
  // Numbered ones first: they settle against an exact identifier without a page
  // fetch, so they are the cheapest work in the batch.
  const ordered = [...fresh.filter((c) => c.number), ...fresh.filter((c) => !c.number)];
  const batch = [...known, ...ordered.slice(0, MAX)];

  console.log(`\n  ${kept.length} figures read`);
  console.log(`    ${known.length} already imported — refreshing price and stock`);
  console.log(`    ${fresh.length} not yet held, taking ${Math.min(MAX, ordered.length)}\n`);

  const tally: Record<Outcome, number> = {
    refreshed: 0,
    attached: 0,
    created: 0,
    unreadable: 0,
    skipped: 0,
  };
  for (const c of batch) {
    const { outcome, detail } = await handle(c);
    tally[outcome] += 1;
    // Refreshes are the bulk and say nothing new; print the rest.
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
