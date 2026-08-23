import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { prisma } from "../lib/prisma";
import { slugify } from "../lib/utils";
import { USER_AGENT } from "../lib/site";
import {
  STORE_ORIGIN,
  categoryFor,
  characterKitCollections,
  classify,
  parseSpecs,
  planSync,
  statusFor,
  type Candidate,
  type ProductSpecs,
} from "../lib/ingest/kotobukiya";

/**
 * Import figures from the Kotobukiya US store.
 *
 *   npm run import:kotobukiya                  # dry run
 *   npm run import:kotobukiya -- --yes
 *   npm run import:kotobukiya -- --limit 25    # try a handful first
 *   npm run import:kotobukiya -- --refresh     # re-read pages already imported
 *
 * Safe to run on a schedule; the nightly job in .github/workflows/store-sync.yml
 * is this with --yes. Each run does three things:
 *
 *   new products      read the product page for specs, then create the figure
 *   known products    refresh price and availability from the index alone
 *   delisted products clear the store link, keeping the figure
 *
 * The index comes from Shopify's own /products.json — their whole catalogue in
 * six requests — and gives titles, SKUs, prices and availability. Only the
 * specs (release month, scale, size, series) need a product page, and only for
 * products we have never seen, so a quiet night costs six requests.
 *
 * Delisting matters because a store link that 404s is worse than no link. Their
 * index lists everything they sell, so a product of ours missing from it has
 * been withdrawn — no need to fetch a page to discover a dead URL. The figure
 * stays: it existed, it has price history, and the marketplace listings below
 * are exactly what someone wants once it is no longer sold new.
 *
 * Prices here are US retail in USD, not Japanese MSRP. That is a deliberate
 * choice with a real cost — "MSRP" now means two things across the catalogue —
 * and the alternative was worse: the Japanese product site is behind a
 * Cloudflare challenge, and the two stores share no key to join on. See
 * lib/ingest/kotobukiya.ts.
 */

const APPLY = process.argv.includes("--yes");
const REFRESH = process.argv.includes("--refresh");
const CACHE = join(process.cwd(), ".cache", "kotobukiya");
const PAGE_DELAY_MS = 700;
const MANUFACTURER = "Kotobukiya";
const SKU_KIND = "KOTOBUKIYA_SKU";
const STORE_KIND = "KOTOBUKIYA_US_PRODUCT";

function flag(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? (process.argv[i + 1] ?? null) : null;
}

const LIMIT = Number(flag("limit") ?? "0") || 0;

async function fetchText(url: string): Promise<string | null> {
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

/** Product pages are cached on disk; they change rarely and re-runs are common. */
async function productPage(url: string): Promise<string | null> {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, `${createHash("sha1").update(url).digest("hex")}.html`);
  if (!REFRESH && existsSync(file)) return readFileSync(file, "utf8");

  const html = await fetchText(url);
  if (html) writeFileSync(file, html);
  await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  return html;
}

/**
 * Which products belong to the character-kit lines.
 *
 * Read from their own collections rather than guessed from titles, because the
 * titles do not say: "VELRETTA First Engage Ver." is a bishoujo kit and reads
 * like nothing at all. Four small requests, and it is the difference between
 * importing Frame Arms Girl and importing Zoids.
 */
async function readCharacterKitIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const handle of characterKitCollections()) {
    const body = await fetchText(`${STORE_ORIGIN}/collections/${handle}/products.json?limit=250`);
    if (!body) {
      // A collection that cannot be read means those kits look like every other
      // plastic model and are skipped. Better than importing Hexa Gear.
      console.warn(`  ! could not read collection ${handle} — its kits will be skipped`);
      continue;
    }
    for (const product of (JSON.parse(body).products ?? []) as { id: number }[]) {
      ids.add(String(product.id));
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return ids;
}

async function readIndex(): Promise<{ candidates: Candidate[]; skipped: Map<string, number> }> {
  const candidates: Candidate[] = [];
  const skipped = new Map<string, number>();

  const characterKitIds = await readCharacterKitIds();
  console.log(`  ${characterKitIds.size} product(s) in the character-kit lines`);

  for (let page = 1; page <= 40; page += 1) {
    const body = await fetchText(`${STORE_ORIGIN}/products.json?limit=250&page=${page}`);
    if (!body) throw new Error(`could not read the product index (page ${page})`);

    const products = (JSON.parse(body).products ?? []) as Parameters<typeof classify>[0][];
    if (products.length === 0) break;

    for (const product of products) {
      const verdict = classify(product, characterKitIds);
      if (verdict.ok) candidates.push(verdict.candidate);
      else skipped.set(verdict.reason, (skipped.get(verdict.reason) ?? 0) + 1);
    }

    process.stdout.write(`\r  index: page ${page}, ${candidates.length} figures so far`);
    if (products.length < 250) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  process.stdout.write("\n");

  return { candidates, skipped };
}

/**
 * The maker named on the product page, not the shop selling it.
 *
 * Kotobukiya's store carries other companies' products — AM-Z02 BLADE LIGER is
 * a Takara Tomy ZOIDS sold through them. Filing everything in this store under
 * "Kotobukiya" would credit the wrong company on every one of those, and the
 * manufacturer is a fact about the figure rather than about where we found it.
 *
 * Falls back to Kotobukiya only when the page states no maker at all.
 */
const manufacturerIds = new Map<string, string>();

async function ensureManufacturer(name: string | null): Promise<string> {
  const clean = (name ?? "").trim() || MANUFACTURER;
  const cached = manufacturerIds.get(clean);
  if (cached) return cached;

  const existing = await prisma.manufacturer.findFirst({
    where: { name: { equals: clean, mode: "insensitive" } },
  });
  if (existing) {
    manufacturerIds.set(clean, existing.id);
    return existing.id;
  }

  const base = slugify(clean);
  let slug = base;
  for (let n = 2; n < 50; n += 1) {
    if (!(await prisma.manufacturer.findUnique({ where: { slug } }))) break;
    slug = `${base}-${n}`;
  }
  const created = await prisma.manufacturer.create({ data: { name: clean, slug } });
  manufacturerIds.set(clean, created.id);
  return created.id;
}

async function ensureSeries(name: string): Promise<string> {
  const existing = await prisma.series.findFirst({ where: { name } });
  if (existing) return existing.id;

  // Series slugs collide with names already taken by other spellings, the same
  // way franchises do. Suffix rather than fail the whole run.
  const base = slugify(name);
  let slug = base;
  for (let n = 2; n < 50; n += 1) {
    if (!(await prisma.series.findUnique({ where: { slug } }))) break;
    slug = `${base}-${n}`;
  }
  const created = await prisma.series.create({ data: { name, slug } });
  return created.id;
}

async function freeSlug(base: string, productId: string): Promise<string> {
  if (!(await prisma.figure.findUnique({ where: { slug: base }, select: { id: true } }))) return base;
  return `${base}-${productId}`;
}

/**
 * Products we hold that the store no longer lists.
 *
 * Clears the store link and everything read off it, and leaves the figure
 * alone. Their page is gone, so keeping the URL would leave a row on the figure
 * page pointing at a 404 — the exact complaint that killed the first attempt at
 * Good Smile store links.
 *
 * MSRP is kept. What the manufacturer asked for it does not stop being true
 * when they stop selling it, and for an older figure that is the most useful
 * number on the page.
 */
async function delist(productIds: string[]): Promise<number> {
  if (productIds.length === 0) return 0;

  const rows = await prisma.figureIdentifier.findMany({
    where: { kind: STORE_KIND, value: { in: productIds } },
    select: { figureId: true },
  });
  if (rows.length === 0) return 0;

  const { count } = await prisma.figure.updateMany({
    where: { id: { in: rows.map((r) => r.figureId) }, storeUrl: { not: null } },
    data: {
      storeUrl: null,
      storePriceAmount: null,
      storePriceCurrency: null,
      storeAvailable: null,
      storeClosesAt: null,
      storeCheckedAt: new Date(),
    },
  });
  return count;
}

/**
 * A product ready to write. `specs` is null for one we already hold: its page
 * was not read this run, so there is nothing new to say about its release month
 * or scale, and the fields keep whatever they already had.
 */
type Resolved = { candidate: Candidate; specs: ProductSpecs | null };

async function write(rows: Resolved[]) {
  let created = 0;
  let updated = 0;

  for (const { candidate, specs } of rows) {
    // A product whose page was not read this run contributes no specs. Its
    // manufacturer and series stay as recorded rather than being reassigned
    // from nothing.
    const manufacturerId = specs ? await ensureManufacturer(specs.manufacturer) : null;
    const seriesId = specs?.series ? await ensureSeries(specs.series) : null;

    // The SKU is Kotobukiya's own product code — printed on the box, quoted in
    // eBay titles — so it is the identity worth carrying. But not every entry
    // has one, and a figure with no identifier would be created afresh on every
    // run, so the store's own product id is recorded alongside as a fallback.
    const keys = [
      candidate.sku ? { kind: SKU_KIND, value: candidate.sku } : null,
      { kind: STORE_KIND, value: candidate.productId },
    ].filter((k): k is { kind: string; value: string } => k !== null);

    let existing: { figureId: string } | null = null;
    for (const key of keys) {
      existing = await prisma.figureIdentifier.findUnique({
        where: { kind_value: key },
        select: { figureId: true },
      });
      if (existing) break;
    }

    // Everything the store says about the product right now.
    //
    // MSRP is deliberately not in here. It is set once, when the figure is
    // first seen, and never rewritten — a later discount is not a change to
    // what the manufacturer asked for it, and letting a sale price overwrite
    // MSRP would quietly rewrite history on the one number the page presents
    // as historical. storePriceAmount is what tracks the current price.
    // What the store says about the product right now, refreshed every run.
    const storeFields = {
      // The product on the maker's own store, shown on the figure page above
      // the marketplace listings. Unlike Good Smile — whose store cannot be
      // enumerated, so links arrive one at a time — every product here comes
      // with its own URL, so all 290 get one for free.
      //
      // storeAvailable is Shopify's own flag: whether they will take an order
      // right now. No order window is stated anywhere, so storeClosesAt stays
      // null and the row reads "Currently unavailable" rather than inventing a
      // date for when ordering stopped.
      name: candidate.title,
      storeUrl: candidate.url,
      storePriceAmount: candidate.priceUsd,
      storePriceCurrency: "USD",
      storeAvailable: candidate.available,
      storeClosesAt: null,
      storeCheckedAt: new Date(),
    };

    // Read off the product page, so only present when the page was read. MSRP
    // is deliberately absent: it is set once, when the figure is first seen,
    // and never rewritten — a later discount is not a change to what the
    // manufacturer asked for it, and letting a sale price overwrite MSRP would
    // quietly rewrite history on the one number the page presents as
    // historical. storePriceAmount is what tracks the current price.
    const specFields = specs
      ? {
          category: categoryFor(specs) as never,
          status: statusFor(specs.releaseDate) as never,
          scale: specs.scale,
          heightMm: specs.heightMm,
          releaseDate: specs.releaseDate,
          manufacturerId,
          seriesId,
        }
      : {};

    const data = { ...storeFields, ...specFields };

    if (existing) {
      await prisma.figure.update({ where: { id: existing.figureId }, data });
      // Backfill identifiers a previous run may not have written.
      for (const key of keys) {
        await prisma.figureIdentifier.upsert({
          where: { kind_value: key },
          create: { figureId: existing.figureId, ...key },
          update: {},
        });
      }
      updated += 1;
      continue;
    }

    if (!specs) {
      // Only reachable if the index gained a product between the plan and the
      // write. Skipped rather than created without specs — a figure with no
      // series or release month is worse than one imported tomorrow.
      console.log(`    skipped ${candidate.title.slice(0, 40)} — no specs read`);
      continue;
    }

    const figure = await prisma.figure.create({
      data: {
        ...data,
        msrpAmount: candidate.priceUsd,
        msrpCurrency: "USD",
        slug: await freeSlug(slugify(candidate.title), candidate.productId),
      },
    });
    for (const key of keys) {
      await prisma.figureIdentifier.create({ data: { figureId: figure.id, ...key } });
    }
    created += 1;
  }

  return { created, updated };
}

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "postgres://unset").hostname;
  console.log(`\n  ${APPLY ? "Writing to" : "Dry run against"} ${host}\n`);

  const { candidates, skipped } = await readIndex();

  console.log(`\n  ${candidates.length} figures in the index`);
  console.log("  skipped:");
  for (const [reason, n] of [...skipped].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(5)}  ${reason}`);
  }

  // What the store lists, against what we already hold.
  const held = await prisma.figureIdentifier.findMany({
    where: { kind: STORE_KIND },
    select: { value: true },
  });
  const plan = planSync(
    candidates.map((c) => c.productId),
    held.map((h) => h.value),
  );

  console.log(`\n  ${plan.create.length} new, ${plan.update.length} already held, ${plan.delist.length} delisted`);

  // An index that came back empty is far more likely to be a failed fetch or a
  // changed endpoint than every product vanishing at once, and acting on it
  // would strip the store link off the whole catalogue in one run. readIndex
  // already throws on a failed request; this catches the subtler case where it
  // succeeds and returns nothing useful.
  if (candidates.length === 0 && plan.delist.length > 0) {
    throw new Error(
      `refusing to delist ${plan.delist.length} figures: the index returned no figures at all`,
    );
  }

  const wanted = LIMIT > 0 ? candidates.slice(0, LIMIT) : candidates;

  // Only new products need their page read. A known product's price and
  // availability come from the index, and its specs — release month, scale,
  // size — do not change once published. On a quiet night this fetches nothing.
  const needsPage = new Set(REFRESH ? wanted.map((c) => c.productId) : plan.create);
  const work = wanted.filter((c) => needsPage.has(c.productId));
  const known = wanted.filter((c) => !needsPage.has(c.productId));

  if (work.length > 0) console.log(`\n  reading ${work.length} product page(s)`);
  else console.log(`\n  no product pages to read`);

  const resolved: Resolved[] = [];
  const noSpecs: string[] = [];
  for (const [i, candidate] of work.entries()) {
    const html = await productPage(candidate.url);
    if (!html) {
      noSpecs.push(candidate.title);
      continue;
    }
    resolved.push({ candidate, specs: parseSpecs(html) });
    if ((i + 1) % 25 === 0) process.stdout.write(`\r  pages: ${i + 1}/${work.length}`);
  }
  if (work.length > 0) process.stdout.write(`\r  pages: ${work.length}/${work.length}\n`);

  // Known products are refreshed from the index alone. Their specs stay as
  // recorded — passing nulls here would blank a release month we already have.
  for (const candidate of known) {
    resolved.push({ candidate, specs: null });
  }

  // Everything below describes the pages actually read this run. A product we
  // already hold contributes no specs, and counting it as "0 have a release
  // month" would report a gap that is not there.
  const fresh = resolved.filter(
    (r): r is { candidate: Candidate; specs: ProductSpecs } => r.specs !== null,
  );

  if (fresh.length > 0) {
    console.log(`\n  of ${fresh.length} page(s) read:`);
    console.log(`    ${fresh.filter((r) => r.specs.series).length} have a series`);
    console.log(`    ${fresh.filter((r) => r.specs.releaseDate).length} have a release month`);
    console.log(`    ${fresh.filter((r) => r.specs.scale).length} have a scale`);
    console.log(`    ${fresh.filter((r) => r.specs.heightMm).length} have a height`);
    if (noSpecs.length > 0) console.log(`    ${noSpecs.length} page(s) could not be read`);

    // Worth seeing rather than assuming: a quarter of the figures in
    // Kotobukiya's own store are made by somebody else, and each is filed
    // under its real maker.
    const makers = new Map<string, number>();
    for (const { specs } of fresh) {
      const name = specs.manufacturer ?? `${MANUFACTURER} (not stated)`;
      makers.set(name, (makers.get(name) ?? 0) + 1);
    }
    console.log("\n  manufacturers:");
    for (const [name, n] of [...makers].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(5)}  ${name}`);
    }

    console.log("\n  sample:");
    for (const { candidate, specs } of fresh.slice(0, 5)) {
      const date = specs.releaseDate?.toISOString().slice(0, 7) ?? "no date";
      console.log(
        `    ${candidate.sku ?? "—"}  $${candidate.priceUsd}  ${date}  ${specs.scale ?? "—"}  ${candidate.title.slice(0, 48)}`,
      );
    }
  }

  if (plan.delist.length > 0) {
    const going = await prisma.figure.findMany({
      where: {
        identifiers: { some: { kind: STORE_KIND, value: { in: plan.delist } } },
        storeUrl: { not: null },
      },
      select: { slug: true },
      take: 10,
    });
    console.log(`\n  delisting ${plan.delist.length} product(s); their store links are cleared:`);
    for (const f of going) console.log(`    ${f.slug}`);
    if (plan.delist.length > going.length) {
      console.log(`    … and ${plan.delist.length - going.length} more`);
    }
  }

  if (!APPLY) {
    console.log("\n  Dry run. Re-run with --yes to import.\n");
    await prisma.$disconnect();
    return;
  }

  const { created, updated } = await write(resolved);
  const cleared = await delist(plan.delist);
  console.log(`\n  Done. ${created} created, ${updated} updated, ${cleared} store link(s) cleared.`);
  console.log("  Run `npm run assign:franchises -- --yes` to file the new series.\n");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
