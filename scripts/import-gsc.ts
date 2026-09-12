/**
 * Import the Good Smile Company product archive.
 *
 *   npm run import:gsc                    # dry run, first 3 pages
 *   npm run import:gsc -- --pages 1-290   # dry run, everything
 *   npm run import:gsc -- --pages 1-5 --write
 *
 * Dry run by default, and the default is small on purpose: a full sweep is
 * ~10,400 products and several hours of polite crawling, which is not something
 * anyone should start by pressing enter on the wrong command.
 *
 * Politeness. Requests are strictly sequential with a delay between them, they
 * identify us with the site's User-Agent, and every page fetched is cached to
 * disk so re-running a dry run costs Good Smile nothing at all. goodsmile.info
 * publishes no robots.txt; the shop's disallows only its search pages, which is
 * exactly why this reads the archive instead.
 *
 * What it takes. Facts only: name, manufacturer, series, category, retail
 * price, release date, scale, height. Not the marketing description, and not
 * the images — those are Good Smile's, and catalogue images go through the
 * permission process in private/PRESS_IMAGES.md. Image URLs appear in the report
 * so you can see what exists; --write does not store them.
 */
import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { prisma } from "../lib/prisma";
import { USER_AGENT } from "../lib/site";
import { slugify } from "../lib/utils";
import {
  classify,
  listingUrl,
  parseListing,
  parseProduct,
  productUrl,
  rejectedByCategory,
  type GscListItem,
  type ParsedFigure,
  type RejectReason,
  type Rejection,
} from "../lib/ingest/gsc";

// --- Options ---------------------------------------------------------------

const argv = process.argv.slice(2);

function flag(name: string): string | null {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
}

const WRITE = argv.includes("--write");
const DELAY_MS = Number(flag("delay") ?? 1500);
const LIMIT = Number(flag("limit") ?? Infinity);
const OUT = flag("out");
const CACHE_DIR = flag("cache") ?? ".gsc-cache";
const NO_CACHE = argv.includes("--no-cache");

const { from: FROM, to: TO } = (() => {
  const raw = flag("pages");
  if (!raw) return { from: 2, to: 4 };
  const m = raw.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) throw new Error(`--pages wants "5" or "1-290", got "${raw}"`);
  const from = Number(m[1]);
  return { from, to: m[2] ? Number(m[2]) : from };
})();

// --- Fetching --------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let fetched = 0;
let fromCache = 0;

function cachePath(url: string): string {
  const safe = url.replace(/^https?:\/\//, "").replace(/[^a-z0-9.-]+/gi, "_");
  return path.join(CACHE_DIR, `${safe.slice(0, 180)}.html`);
}

/**
 * Fetch one page, caching to disk.
 *
 * Retries twice with a growing pause. A transient failure on page 173 of 290
 * shouldn't cost the whole crawl, and backing off is the right response to a
 * server that's struggling regardless of why.
 */
async function get(url: string): Promise<string | null> {
  const file = cachePath(url);
  if (!NO_CACHE && existsSync(file)) {
    fromCache += 1;
    return readFile(file, "utf8");
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (fetched > 0) await sleep(DELAY_MS);
      fetched += 1;
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
        redirect: "follow",
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      if (!NO_CACHE) {
        await mkdir(CACHE_DIR, { recursive: true });
        await writeFile(file, html, "utf8");
      }
      return html;
    } catch (err) {
      if (attempt === 3) {
        console.warn(`  ! gave up on ${url}: ${err instanceof Error ? err.message : err}`);
        return null;
      }
      await sleep(DELAY_MS * attempt * 4);
    }
  }
  return null;
}

// --- Report ----------------------------------------------------------------

type Report = {
  pages: number;
  seen: number;
  accepted: ParsedFigure[];
  rejections: Map<RejectReason, { count: number; examples: string[] }>;
  unknownClasses: Map<string, { count: number; example: string }>;
};

function note(report: Report, item: GscListItem, result: Rejection) {
  const entry = report.rejections.get(result.reason) ?? { count: 0, examples: [] };
  entry.count += 1;
  if (entry.examples.length < 4) entry.examples.push(`${item.name} [${item.classes.join(" ")}]`);
  report.rejections.set(result.reason, entry);

  if (result.reason === "unknown category") {
    for (const cls of item.classes) {
      const seen = report.unknownClasses.get(cls) ?? { count: 0, example: item.name };
      seen.count += 1;
      report.unknownClasses.set(cls, seen);
    }
  }
}

function tally<T>(rows: T[], key: (row: T) => string | null): [string, number][] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const k = key(row) ?? "(none)";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function printReport(report: Report) {
  const { accepted } = report;
  const pct = (n: number) => (accepted.length ? `${Math.round((n / accepted.length) * 100)}%` : "—");

  console.log(`\n${"=".repeat(62)}`);
  console.log(`pages read     : ${report.pages}  (${fetched} fetched, ${fromCache} from cache)`);
  console.log(`products seen  : ${report.seen}`);
  console.log(`figures        : ${accepted.length}`);
  console.log(`rejected       : ${report.seen - accepted.length}`);

  console.log(`\n--- why things were rejected ---`);
  for (const [reason, { count, examples }] of [...report.rejections].sort(
    (a, b) => b[1].count - a[1].count,
  )) {
    console.log(`  ${String(count).padStart(5)}  ${reason}`);
    for (const e of examples) console.log(`         e.g. ${e.slice(0, 78)}`);
  }

  if (report.unknownClasses.size > 0) {
    console.log(`\n--- categories with no ruling (excluded; decide and add to gsc.ts) ---`);
    for (const [cls, { count, example }] of [...report.unknownClasses].sort(
      (a, b) => b[1].count - a[1].count,
    )) {
      console.log(`  ${String(count).padStart(5)}  ${cls.padEnd(22)} e.g. ${example.slice(0, 46)}`);
    }
  }

  console.log(`\n--- accepted, by category ---`);
  for (const [k, n] of tally(accepted, (f) => f.category)) {
    console.log(`  ${String(n).padStart(5)}  ${k}`);
  }

  console.log(`\n--- accepted, by manufacturer ---`);
  for (const [k, n] of tally(accepted, (f) => f.manufacturer).slice(0, 12)) {
    console.log(`  ${String(n).padStart(5)}  ${k}`);
  }

  const withPrice = accepted.filter((f) => f.msrpJpy !== null).length;
  const withDate = accepted.filter((f) => f.releaseYear !== null).length;
  const withHeight = accepted.filter((f) => f.heightMm !== null).length;
  const withSeries = accepted.filter((f) => f.series).length;
  console.log(`\n--- how complete the data is ---`);
  console.log(`  MSRP         ${String(withPrice).padStart(5)}  ${pct(withPrice)}`);
  console.log(`  release date ${String(withDate).padStart(5)}  ${pct(withDate)}`);
  console.log(`  height       ${String(withHeight).padStart(5)}  ${pct(withHeight)}`);
  console.log(`  series       ${String(withSeries).padStart(5)}  ${pct(withSeries)}`);
  console.log(`  characters       0  0%   <- the archive has no character field`);

  console.log(`\n--- a sample of what would be created ---`);
  for (const f of accepted.slice(0, 8)) {
    const msrp = f.msrpJpy ? `¥${f.msrpJpy.toLocaleString()}` : "—";
    const rel = f.releaseYear ? `${f.releaseYear}/${String(f.releaseMonth).padStart(2, "0")}` : "—";
    console.log(`  ${f.name.slice(0, 52)}`);
    console.log(
      `     ${f.category} | ${f.manufacturer ?? "—"} | ${f.series ?? "—"} | ` +
        `${f.scale ?? "non-scale"} | ${f.heightMm ?? "—"}mm | ${msrp} | ${rel}`,
    );
  }
}

// --- Writing ---------------------------------------------------------------

/**
 * Find a slug nobody else is using.
 *
 * Slugs are unique, and slugify is lossy: "IDOLiSH7" and "Idolish7" are two
 * different series names in the archive that both reduce to "idolish7". Left
 * alone that is not a bad row, it is a crash partway through an import — which
 * is how it was found.
 *
 * The suffix is deliberately dull. Two rows that collide here are usually the
 * same franchise spelled differently, and `npm run dedupe:series` will offer to
 * merge them on conclusive evidence; this only has to get the import finished
 * without inventing anything.
 */
async function freeSlug(
  base: string,
  isTaken: (slug: string) => Promise<boolean>,
): Promise<string> {
  if (!(await isTaken(base))) return base;
  for (let n = 2; n < 50; n++) {
    const candidate = `${base}-${n}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new Error(`no free slug for "${base}" after 50 tries`);
}

/**
 * Get the series by name, creating it with a free slug if it is new.
 *
 * Checks synonyms as well as the name, and that is not a nicety — it is what
 * stops an import undoing a merge. `dedupe:series` keeps the name it merged
 * away as a synonym of the surviving row, but the archive still calls the
 * product "Character Vocal Series 01: Hatsune Miku" on every run. Matching on
 * name alone would recreate that row each time, quietly unpicking the
 * de-duplication between one import and the next.
 */
async function ensureSeries(name: string): Promise<string> {
  const found = await prisma.series.findUnique({ where: { name }, select: { id: true } });
  if (found) return found.id;

  const merged = await prisma.series.findFirst({
    where: { synonyms: { has: name } },
    select: { id: true, name: true },
  });
  if (merged) {
    console.log(`  "${name}" was merged into "${merged.name}" — keeping it there`);
    return merged.id;
  }
  const slug = await freeSlug(slugify(name), async (s) =>
    Boolean(await prisma.series.findUnique({ where: { slug: s }, select: { id: true } })),
  );
  return (await prisma.series.create({ data: { name, slug }, select: { id: true } })).id;
}

/** Same, for manufacturers. */
async function ensureManufacturer(name: string): Promise<string> {
  const found = await prisma.manufacturer.findUnique({ where: { name }, select: { id: true } });
  if (found) return found.id;
  const slug = await freeSlug(slugify(name), async (s) =>
    Boolean(await prisma.manufacturer.findUnique({ where: { slug: s }, select: { id: true } })),
  );
  return (await prisma.manufacturer.create({ data: { name, slug }, select: { id: true } })).id;
}

/**
 * Slugs have to survive duplicate names.
 *
 * Good Smile have released more than one figure called "Saber", years apart.
 * Upserting on a name-derived slug alone would quietly merge two different
 * products into one row and average their prices together, which is exactly the
 * class of silent wrongness this project keeps trying to avoid. So identity
 * comes from the archive's product ID, and the slug only has to be unique.
 */
async function uniqueSlug(base: string, productId: string): Promise<string> {
  const taken = await prisma.figure.findUnique({ where: { slug: base }, select: { id: true } });
  if (!taken) return base;
  // The archive's product ID is already unique, so one suffix always suffices.
  return `${base}-${productId}`;
}

/**
 * Nendoroid and figma numbers are how collectors actually refer to these.
 * Kept per-line, since figma 100 and Nendoroid 100 are different products.
 *
 * The upsert does nothing when the number is already recorded - including
 * when it sits on a different figure, which is a conflict this import is not
 * the place to resolve.
 */
async function recordLineNumber(
  figureId: string,
  f: { lineNumber: string | null; category: string },
): Promise<void> {
  if (!f.lineNumber) return;
  if (f.category !== "NENDOROID" && f.category !== "FIGMA") return;
  const kind = f.category === "NENDOROID" ? "NENDOROID_NO" : "FIGMA_NO";
  await prisma.figureIdentifier.upsert({
    where: { kind_value: { kind, value: f.lineNumber } },
    update: {},
    create: { figureId, kind, value: f.lineNumber },
  });
}

async function write(figures: ParsedFigure[]) {
  let created = 0;
  let updated = 0;

  for (const f of figures) {
    const manufacturerId = f.manufacturer ? await ensureManufacturer(f.manufacturer) : null;
    const seriesId = f.series ? await ensureSeries(f.series) : null;

    const releaseDate =
      f.releaseYear && f.releaseMonth
        ? new Date(Date.UTC(f.releaseYear, f.releaseMonth - 1, 15))
        : null;

    const data = {
      name: f.name,
      nameJa: f.nameJa,
      category: f.category,
      scale: f.scale,
      heightMm: f.heightMm,
      releaseDate,
      msrpAmount: f.msrpJpy ?? null,
      msrpCurrency: f.msrpJpy ? "JPY" : null,
      manufacturerId,
      seriesId,
      // primaryImageUrl is deliberately not set — see the note at the top.
    };

    const existing = await prisma.figureIdentifier.findUnique({
      where: { kind_value: { kind: "GSC_PRODUCT", value: f.productId } },
      select: { figureId: true },
    });

    if (existing) {
      await prisma.figure.update({ where: { id: existing.figureId }, data });
      // The number too, not only on the create path below. A figure that
      // already existed - because another importer reached it first, or
      // because this import ran twice - used to skip straight past the number
      // block and never get one, which is how 141 numbered products ended up
      // unable to match listings quoting their own number.
      await recordLineNumber(existing.figureId, f);
      updated += 1;
      continue;
    }

    const slug = await uniqueSlug(slugify(`${f.name}-${f.manufacturer ?? "gsc"}`), f.productId);
    const figure = await prisma.figure.create({ data: { ...data, slug } });
    await prisma.figureIdentifier.create({
      data: { figureId: figure.id, kind: "GSC_PRODUCT", value: f.productId },
    });

    await recordLineNumber(figure.id, f);
    created += 1;
  }

  console.log(`\nWrote ${created} new figure(s), updated ${updated}.`);
  console.log(`Run "npm run reindex" so search picks them up.`);
}

// --- Main ------------------------------------------------------------------

async function main() {
  console.log(`Good Smile archive import — ${WRITE ? "WRITE" : "DRY RUN"}`);
  console.log(`pages ${FROM}-${TO}, ${DELAY_MS}ms between requests, cache: ${NO_CACHE ? "off" : CACHE_DIR}\n`);

  const report: Report = {
    pages: 0,
    seen: 0,
    accepted: [],
    rejections: new Map(),
    unknownClasses: new Map(),
  };

  for (let page = FROM; page <= TO && report.accepted.length < LIMIT; page++) {
    const html = await get(listingUrl(page));
    if (!html) {
      console.log(`page ${page}: unavailable, skipping`);
      continue;
    }

    const { items, totalPages } = parseListing(html);
    report.pages += 1;
    report.seen += items.length;
    console.log(
      `page ${page}${totalPages ? `/${totalPages}` : ""}: ${items.length} products` +
        ` (${report.accepted.length} figures so far)`,
    );

    for (const item of items) {
      if (report.accepted.length >= LIMIT) break;

      // Rule out by category before spending a request on the product page.
      const early = rejectedByCategory(item);
      if (early) {
        note(report, item, early);
        continue;
      }

      const productHtml = await get(productUrl(item.path));
      const result = classify(item, productHtml ? parseProduct(productHtml) : null);
      if (result.ok) report.accepted.push(result.figure);
      else note(report, item, result);
    }
  }

  printReport(report);

  if (OUT) {
    await writeFile(OUT, JSON.stringify(report.accepted, null, 2), "utf8");
    console.log(`\nWrote ${report.accepted.length} figures to ${OUT}`);
  }

  if (!WRITE) {
    console.log(`\nDry run — nothing was written. Re-run with --write to import.`);
    console.log(`Check the "no ruling" list above first: those are excluded until you decide.`);
  } else {
    await write(report.accepted);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
