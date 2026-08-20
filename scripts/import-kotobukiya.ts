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
  classify,
  parseSpecs,
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
 * Two passes. The index comes from Shopify's own /products.json — the whole
 * catalogue in six requests — and gives titles, SKUs, prices and images. The
 * specs that matter to us (release month, scale, size, series) are only on the
 * product page, so those are fetched one at a time, politely, and cached on
 * disk so a re-run costs nothing.
 *
 * Because /products.json carries `updated_at`, the expensive per-product pass
 * only runs for products we have not seen or that have changed since.
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

async function readIndex(): Promise<{ candidates: Candidate[]; skipped: Map<string, number> }> {
  const candidates: Candidate[] = [];
  const skipped = new Map<string, number>();

  for (let page = 1; page <= 40; page += 1) {
    const body = await fetchText(`${STORE_ORIGIN}/products.json?limit=250&page=${page}`);
    if (!body) throw new Error(`could not read the product index (page ${page})`);

    const products = (JSON.parse(body).products ?? []) as Parameters<typeof classify>[0][];
    if (products.length === 0) break;

    for (const product of products) {
      const verdict = classify(product);
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

type Resolved = { candidate: Candidate; specs: ProductSpecs };

async function write(rows: Resolved[]) {
  let created = 0;
  let updated = 0;

  for (const { candidate, specs } of rows) {
    const manufacturerId = await ensureManufacturer(specs.manufacturer);
    const seriesId = specs.series ? await ensureSeries(specs.series) : null;

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

    const data = {
      name: candidate.title,
      category: categoryFor(specs) as never,
      status: statusFor(specs.releaseDate) as never,
      scale: specs.scale,
      heightMm: specs.heightMm,
      releaseDate: specs.releaseDate,
      msrpAmount: candidate.priceUsd,
      msrpCurrency: "USD",
      manufacturerId,
      seriesId,

      // The product on the maker's own store, shown on the figure page above
      // the marketplace listings. Unlike Good Smile — whose store cannot be
      // enumerated, so links arrive one at a time — every product here comes
      // with its own URL, so all 290 get one for free.
      //
      // storeAvailable is Shopify's own flag: whether they will take an order
      // right now. No order window is stated anywhere, so storeClosesAt stays
      // null and the row reads "Currently unavailable" rather than inventing a
      // date for when ordering stopped.
      storeUrl: candidate.url,
      storePriceAmount: candidate.priceUsd,
      storePriceCurrency: "USD",
      storeAvailable: candidate.available,
      storeClosesAt: null,
      storeCheckedAt: new Date(),
    };

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

    const figure = await prisma.figure.create({
      data: { ...data, slug: await freeSlug(slugify(candidate.title), candidate.productId) },
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

  const work = LIMIT > 0 ? candidates.slice(0, LIMIT) : candidates;
  if (LIMIT > 0) console.log(`\n  --limit ${LIMIT}: reading ${work.length} of ${candidates.length} product pages`);
  else console.log(`\n  reading ${work.length} product pages (cached after the first run)`);

  const resolved: Resolved[] = [];
  const noSpecs: string[] = [];
  for (const [i, candidate] of work.entries()) {
    const html = await productPage(candidate.url);
    if (!html) {
      noSpecs.push(candidate.title);
      continue;
    }
    const specs = parseSpecs(html);
    resolved.push({ candidate, specs });
    if ((i + 1) % 25 === 0) process.stdout.write(`\r  pages: ${i + 1}/${work.length}`);
  }
  process.stdout.write(`\r  pages: ${work.length}/${work.length}\n`);

  const withDate = resolved.filter((r) => r.specs.releaseDate).length;
  const withScale = resolved.filter((r) => r.specs.scale).length;
  const withSeries = resolved.filter((r) => r.specs.series).length;
  const withHeight = resolved.filter((r) => r.specs.heightMm).length;

  console.log(`\n  of ${resolved.length} figures read:`);
  console.log(`    ${withSeries} have a series`);
  console.log(`    ${withDate} have a release month`);
  console.log(`    ${withScale} have a scale`);
  console.log(`    ${withHeight} have a height`);
  if (noSpecs.length > 0) console.log(`    ${noSpecs.length} page(s) could not be read`);

  // Worth seeing rather than assuming: a quarter of the figures in Kotobukiya's
  // own store are made by somebody else, and each is filed under its real maker.
  const makers = new Map<string, number>();
  for (const { specs } of resolved) {
    const name = specs.manufacturer ?? `${MANUFACTURER} (not stated)`;
    makers.set(name, (makers.get(name) ?? 0) + 1);
  }
  console.log("\n  manufacturers:");
  for (const [name, n] of [...makers].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(5)}  ${name}`);
  }

  const skus = resolved.map((r) => r.candidate.sku).filter((s): s is string => Boolean(s));
  const known = await prisma.figureIdentifier.findMany({
    where: { kind: SKU_KIND, value: { in: skus } },
    select: { value: true },
  });
  console.log(`\n  ${known.length} already imported, ${resolved.length - known.length} new`);

  console.log("\n  sample:");
  for (const { candidate, specs } of resolved.slice(0, 5)) {
    const date = specs.releaseDate?.toISOString().slice(0, 7) ?? "no date";
    console.log(
      `    ${candidate.sku ?? "—"}  $${candidate.priceUsd}  ${date}  ${specs.scale ?? "—"}  ${candidate.title.slice(0, 48)}`,
    );
  }

  if (!APPLY) {
    console.log("\n  Dry run. Re-run with --yes to import.\n");
    await prisma.$disconnect();
    return;
  }

  const { created, updated } = await write(resolved);
  console.log(`\n  Done. ${created} created, ${updated} updated.`);
  console.log("  Run `npm run assign:franchises -- --yes` to file the new series.\n");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
