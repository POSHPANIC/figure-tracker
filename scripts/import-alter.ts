import "dotenv/config";
import { prisma } from "../lib/prisma";
import { slugify } from "../lib/utils";
import { USER_AGENT } from "../lib/site";
import {
  IDENTIFIER_KIND,
  isFigure,
  parseProductPage,
  productUrl,
  type AlterProduct,
} from "../lib/ingest/alter";
import { decide as decideNsfw } from "../lib/ingest/nsfw";
import { findHeldProduct } from "../lib/ingest/held-product";
import { fillMissing } from "../lib/ingest/shop-offer";

/**
 * Import Alter's catalogue.
 *
 *   npm run import:alter                     # dry run
 *   npm run import:alter -- --yes
 *   npm run import:alter -- --yes --max 120
 *   npm run import:alter -- --yes --from 1 --to 200
 *
 * The first manufacturer added since the Good Smile archive stopped
 * publishing, and the reason to bother is the price. Every shop imported this
 * year states what it charges — an exporter's margin at Solaris, a discount at
 * HobbyLink — which is a fact about the shop. Alter state the number printed
 * on the box, so this writes msrpAmount, which no retailer import may do.
 *
 * They were also the biggest hole in the catalogue: a top-tier scale maker
 * with roughly 660 releases, of which this site held seven.
 *
 * The walk is the archive's shape. Sequential ids, a 404 past the end, and a
 * cursor in Setting so a nightly slice picks up where the last one stopped
 * rather than starting again. On reaching the end it rewinds behind the last
 * live product, which is what catches new releases: they are added at the top.
 *
 * No ShopOffer is written. alter-web.jp is a product site, not a shop — it
 * lists the stores that stock them — so there is nothing here to link a buyer
 * to, and inventing an offer would be a claim they do not make.
 */

const APPLY = process.argv.includes("--yes");
const DELAY_MS = 1500;
const CURSOR_KEY = "alter:productCursor";
/** Consecutive 404s that mean the end of the range rather than a gap. */
const DRY_RUN_LENGTH = 40;
/** How far behind the last live product to rewind, to catch new releases. */
const TAIL_REWIND = 30;
/** A backstop only. The walk normally ends on a dry stretch. */
const ID_CEILING = 5000;

function intArg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const n = i !== -1 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const MAX = intArg("max", 120);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

async function freeSlug(base: string, taken: (s: string) => Promise<boolean>): Promise<string> {
  let slug = base;
  for (let n = 2; n < 60; n += 1) {
    if (!(await taken(slug))) return slug;
    slug = `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

async function ensureManufacturer(): Promise<string> {
  const name = "Alter";
  const existing = await prisma.manufacturer.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) return existing.id;
  const slug = await freeSlug(slugify(name), async (s) =>
    Boolean(await prisma.manufacturer.findUnique({ where: { slug: s }, select: { id: true } })),
  );
  return (await prisma.manufacturer.create({ data: { name, slug }, select: { id: true } })).id;
}

/** The same rule import-gsc uses: an existing series wins, a merged one too. */
async function ensureSeries(name: string): Promise<string> {
  const found = await prisma.series.findUnique({ where: { name }, select: { id: true } });
  if (found) return found.id;

  const merged = await prisma.series.findFirst({
    where: { synonyms: { has: name } },
    select: { id: true, name: true },
  });
  if (merged) return merged.id;

  const slug = await freeSlug(slugify(name), async (s) =>
    Boolean(await prisma.series.findUnique({ where: { slug: s }, select: { id: true } })),
  );
  return (await prisma.series.create({ data: { name, slug }, select: { id: true } })).id;
}

async function heldBy(kind: string, value: string): Promise<string | null> {
  const row = await prisma.figureIdentifier.findUnique({
    where: { kind_value: { kind, value } },
    select: { figureId: true },
  });
  return row?.figureId ?? null;
}

async function recordIdentifier(figureId: string, productId: string) {
  await prisma.figureIdentifier.upsert({
    where: { kind_value: { kind: IDENTIFIER_KIND, value: productId } },
    create: { figureId, kind: IDENTIFIER_KIND, value: productId },
    update: {},
  });
}

/** Where the last run stopped. */
async function resumeFrom(): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: CURSOR_KEY } });
  const stored = Number(row?.value);
  return Number.isFinite(stored) && stored > 0 ? stored : 1;
}

async function saveCursor(next: number) {
  await prisma.setting.upsert({
    where: { key: CURSOR_KEY },
    create: { key: CURSOR_KEY, value: String(next) },
    update: { value: String(next) },
  });
}

type Outcome = "refreshed" | "attached" | "created" | "skipped" | "untitled" | "missing";

async function handle(product: AlterProduct, makerId: string): Promise<Outcome> {
  // --- Known product: fill any gaps, and stop ------------------------------
  const known = await heldBy(IDENTIFIER_KIND, product.productId);
  if (known) {
    if (APPLY) {
      await fillMissing(known, {
        scale: product.scale,
        heightMm: product.heightMm,
        releaseDate: product.releaseDate,
        nameJa: product.nameJa,
        msrpAmount: product.msrpAmount,
        msrpCurrency: product.msrpAmount === null ? null : "JPY",
        manufacturerId: makerId,
        seriesId: product.seriesEn ? await ensureSeries(product.seriesEn) : null,
      });
    }
    return "refreshed";
  }

  // --- Something we already hold under another source ----------------------
  const held = await findHeldProduct({
    name: product.name!,
    manufacturer: "Alter",
    category: product.scale ? "SCALE" : "OTHER",
  });
  // ...unless it already carries a different one of their product ids.
  //
  // A maker's own catalogue has one page per product, so two ids are two
  // products however alike the names read. Alter release the same character
  // repeatedly -- four separate pages are called "USS St.Louis", three
  // "Asuna" -- and letting the name guard decide merged all four into one
  // figure on the first run of this import. The identifier is the better
  // evidence and it disagrees, so it wins.
  const alreadyKeyed = held
    ? await prisma.figureIdentifier.findFirst({
        where: { figureId: held.id, kind: IDENTIFIER_KIND },
        select: { value: true },
      })
    : null;

  if (held && !alreadyKeyed) {
    if (APPLY) {
      await recordIdentifier(held.id, product.productId);
      await fillMissing(held.id, {
        scale: product.scale,
        heightMm: product.heightMm,
        releaseDate: product.releaseDate,
        nameJa: product.nameJa,
        msrpAmount: product.msrpAmount,
        msrpCurrency: product.msrpAmount === null ? null : "JPY",
        manufacturerId: makerId,
        seriesId: product.seriesEn ? await ensureSeries(product.seriesEn) : null,
      });
    }
    console.log(`  attached   ${product.productId} → ${held.name.slice(0, 46)}`);
    return "attached";
  }

  if (!APPLY) {
    console.log(`  created    ${product.productId}  ${(product.name ?? "").slice(0, 46)}`);
    return "created";
  }

  const slug = await freeSlug(slugify(product.name!), async (s) =>
    Boolean(await prisma.figure.findUnique({ where: { slug: s }, select: { id: true } })),
  );

  const figure = await prisma.figure.create({
    data: {
      name: product.name!,
      nameJa: product.nameJa,
      slug,
      category: (product.scale ? "SCALE" : "OTHER") as never,
      status: (product.releaseDate && product.releaseDate.getTime() > Date.now()
        ? "PREORDER"
        : "RELEASED") as never,
      releaseDate: product.releaseDate,
      // They state a month and never a day, so the MSRP converts at the
      // month's average rate rather than a day's.
      releaseDatePrecision: "MONTH",
      scale: product.scale,
      heightMm: product.heightMm,
      // The number on the box, excluding tax — the reason this source exists.
      msrpAmount: product.msrpAmount,
      msrpCurrency: product.msrpAmount === null ? null : "JPY",
      manufacturerId: makerId,
      seriesId: product.seriesEn ? await ensureSeries(product.seriesEn) : null,
      ...(() => {
        const verdict = decideNsfw({ name: product.name! });
        return verdict ? { nsfw: verdict.nsfw, nsfwSource: verdict.source } : {};
      })(),
    },
    select: { id: true, slug: true },
  });

  await recordIdentifier(figure.id, product.productId);
  console.log(`  created    ${product.productId}  ${figure.slug.slice(0, 50)}`);
  return "created";
}

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "postgres://unset").hostname;
  const from = intArg("from", await resumeFrom());
  const to = Math.min(intArg("to", from + MAX - 1), ID_CEILING);

  console.log(`\n  ${APPLY ? "Writing to" : "Dry run against"} ${host}`);
  console.log(`  Walking product ids ${from}–${to}\n`);

  const makerId = APPLY ? await ensureManufacturer() : "";
  const tally: Record<Outcome, number> = {
    refreshed: 0,
    attached: 0,
    created: 0,
    skipped: 0,
    untitled: 0,
    missing: 0,
  };

  let dry = 0;
  let frontier = from - 1;
  let scanned = from - 1;
  let hitTheEnd = false;

  for (let id = from; id <= to; id += 1) {
    scanned = id;
    await sleep(DELAY_MS);
    const fetched = await fetchPage(productUrl(id));

    if ("gone" in fetched) {
      tally.missing += 1;
      dry += 1;
      if (dry >= DRY_RUN_LENGTH) {
        console.log(`\n  ${DRY_RUN_LENGTH} ids in a row with nothing behind them — stopping at ${id}.`);
        hitTheEnd = true;
        break;
      }
      continue;
    }
    if ("failed" in fetched) {
      tally.missing += 1;
      continue;
    }
    dry = 0;
    frontier = id;

    const product = parseProductPage(fetched.html, productUrl(id));
    if (!product || !isFigure(product)) {
      tally.skipped += 1;
      continue;
    }
    // Counted apart from "skipped", because these are figures we would want
    // and cannot name — the English row is empty on their older products. It
    // is a gap in the source, not a decision about the product, and lumping
    // the two together would hide how much is being left behind.
    if (!product.name) {
      tally.untitled += 1;
      continue;
    }
    tally[await handle(product, makerId)] += 1;
  }

  console.log(
    `\n  refreshed ${tally.refreshed}  attached ${tally.attached}  created ${tally.created}` +
      `  skipped ${tally.skipped}  nothing there ${tally.missing}`,
  );
  if (tally.untitled) {
    console.log(
      `  ${tally.untitled} product(s) left alone: Alter state no English name for them.`,
    );
  }

  // Past the end of their range, sit just behind the last live product rather
  // than running off into empty ids. New releases are added at the top.
  const next = hitTheEnd ? Math.max(1, frontier - TAIL_REWIND) : scanned + 1;
  if (APPLY) await saveCursor(next);
  console.log(
    `  Next run resumes at ${next}` +
      `${hitTheEnd ? ` (rewound behind the last live product, ${frontier})` : ""}.`,
  );
  if (!APPLY) console.log("  Dry run — pass --yes to write. Cursor not moved.\n");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
