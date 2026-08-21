import "dotenv/config";
import { prisma } from "../lib/prisma";
import { slugify } from "../lib/utils";
import { USER_AGENT } from "../lib/site";
import { parseProductPage, tidyName, type SolarisSpecs } from "../lib/ingest/solaris-product";
import { normalizeQuery } from "../lib/search-text";
import { decide as decideNsfw } from "../lib/ingest/nsfw";

/**
 * Work through the review queue, a little each day.
 *
 *   npm run process:candidates                # dry run
 *   npm run process:candidates -- --yes
 *   npm run process:candidates -- --take 25
 *
 * Reads the product page behind each Solaris candidate and decides one of three
 * things. The tiers exist because the evidence differs, and so should the
 * confidence:
 *
 *   attach   its JAN or release number matches a figure we hold. Exact, so the
 *            candidate closes against that figure and nothing is created.
 *   create   nothing matches and no similarly named figure exists. Created with
 *            the barcode, the real specs and a link to the shop.
 *   leave    nothing matches but a similar name does. The one case a person
 *            still has to judge, and the only way this makes a duplicate.
 *
 * A duplicate is far more work to unpick than to prevent — one cost a cleanup
 * pass earlier this week — so anything ambiguous stays in the queue rather than
 * being guessed at.
 *
 * Small batches on purpose. This fetches one page per candidate at a polite
 * interval, and a catalogue grown twenty figures a night is one somebody can
 * still check.
 */

const APPLY = process.argv.includes("--yes");
const PAGE_DELAY_MS = 900;

function intArg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const n = i !== -1 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const TAKE = intArg("take", 20);

type Outcome = "attached" | "created" | "left" | "unreadable";

async function fetchPage(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: controller.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A figure already in the catalogue that this is probably the same product as.
 *
 * Deliberately crude and deliberately eager to say yes. Its job is not to
 * decide anything — it is to send the ambiguous cases to a person. A false
 * "similar" costs one manual review; a false "nothing like it" costs a
 * duplicate that somebody has to find and merge later.
 */
async function findSimilar(title: string): Promise<{ slug: string; name: string } | null> {
  // Their titles read "Series - Character - Line - Ver. (Manufacturer)". The
  // character is the second segment and is the part most likely to appear in a
  // name the catalogue already uses.
  const segments = title.split(" - ").map((s) => s.trim()).filter(Boolean);
  const character = segments[1] ?? segments[0] ?? "";
  const needle = normalizeQuery(character);
  if (needle.length < 4) return null;

  const rows = await prisma.figure.findMany({
    where: { searchText: { contains: needle } },
    select: { slug: true, name: true },
    take: 1,
  });
  return rows[0] ?? null;
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

type Candidate = {
  id: string;
  key: string;
  line: string | null;
  number: string | null;
  sourceUrl: string | null;
  vendor: string | null;
  sampleTitles: string[];
  nsfw: boolean;
  nsfwSource: string | null;
};

async function close(id: string, figureId: string) {
  await prisma.figureCandidate.update({
    where: { id },
    data: { status: "ACCEPTED", figureId, reviewedAt: new Date() },
  });
}

async function handle(c: Candidate): Promise<{ outcome: Outcome; detail: string }> {
  const title = c.sampleTitles[0] ?? "";
  if (!c.sourceUrl) return { outcome: "left", detail: "no product url" };

  const html = await fetchPage(c.sourceUrl);
  await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  if (!html) return { outcome: "unreadable", detail: "page would not load" };

  const specs = parseProductPage(html);

  // --- Tier 1: an exact identifier we already hold -------------------------
  const exact: { kind: string; value: string }[] = [];
  if (specs.jan) exact.push({ kind: "JAN", value: specs.jan });
  if (c.line && c.number) {
    exact.push({ kind: c.line === "FIGMA" ? "FIGMA_NO" : "NENDOROID_NO", value: c.number });
  }

  for (const key of exact) {
    const held = await prisma.figureIdentifier.findUnique({
      where: { kind_value: key },
      select: { figureId: true, figure: { select: { slug: true } } },
    });
    if (held) {
      if (APPLY) {
        await close(c.id, held.figureId);
        // Record the barcode against it while we have it — it is the join key
        // that makes the next source cheap to match.
        if (specs.jan) {
          await prisma.figureIdentifier.upsert({
            where: { kind_value: { kind: "JAN", value: specs.jan } },
            create: { figureId: held.figureId, kind: "JAN", value: specs.jan },
            update: {},
          });
        }
      }
      return { outcome: "attached", detail: `${key.kind} ${key.value} → ${held.figure.slug}` };
    }
  }

  // --- Tier 3 test before tier 2: is something like it already listed? -----
  const similar = await findSimilar(specs.name ?? title);
  if (similar) {
    return { outcome: "left", detail: `looks like ${similar.slug}` };
  }

  // --- Tier 2: nothing matches, nothing looks like it. Create it. ----------
  if (!specs.name) return { outcome: "left", detail: "no product name on the page" };

  const name = tidyName(specs.name);
  if (!APPLY) return { outcome: "created", detail: name.slice(0, 60) };

  const base = slugify(name);
  let slug = base;
  for (let n = 2; n < 50; n += 1) {
    if (!(await prisma.figure.findUnique({ where: { slug }, select: { id: true } }))) break;
    slug = `${base}-${n}`;
  }

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
      // claim something about the manufacturer that this source cannot support.
      // The clean URL. Affiliate tagging happens when the page renders, the
      // same as eBay's — so the id lives in one environment variable rather
      // than baked into thousands of rows that would all need rewriting if it
      // ever changed.
      storeUrl: c.sourceUrl,
      storeCheckedAt: new Date(),

      // The retailer classified this themselves at discovery; only fall back to
      // reading the name when they did not. Hidden either way — nothing renders
      // it yet. See lib/ingest/nsfw.ts.
      ...(() => {
        const verdict = c.nsfwSource
          ? { nsfw: c.nsfw, source: c.nsfwSource }
          : decideNsfw({ name });
        return verdict ? { nsfw: verdict.nsfw, nsfwSource: verdict.source } : {};
      })(),

      ...(specs.jan ? { identifiers: { create: { kind: "JAN", value: specs.jan } } } : {}),
    },
    select: { id: true, slug: true },
  });

  await close(c.id, figure.id);
  return { outcome: "created", detail: figure.slug };
}

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "postgres://unset").hostname;
  console.log(`\n  ${APPLY ? "Writing to" : "Dry run against"} ${host}`);
  console.log(`  Taking up to ${TAKE} candidate(s)\n`);

  const candidates = await prisma.figureCandidate.findMany({
    where: { status: "OPEN", source: "SOLARIS", sourceUrl: { not: null } },
    select: { id: true, key: true, line: true, number: true, sourceUrl: true, vendor: true, sampleTitles: true, nsfw: true, nsfwSource: true },
    // Numbered first: those can be settled exactly, so they are the cheapest
    // and safest work in the queue.
    orderBy: [{ number: { sort: "desc", nulls: "last" } }, { firstSeenAt: "asc" }],
    take: TAKE,
  });

  if (candidates.length === 0) {
    console.log("  Nothing to do.\n");
    await prisma.$disconnect();
    return;
  }

  const tally: Record<Outcome, number> = { attached: 0, created: 0, left: 0, unreadable: 0 };
  for (const c of candidates) {
    const { outcome, detail } = await handle(c);
    tally[outcome] += 1;
    console.log(`  ${outcome.padEnd(10)} ${detail}`);
  }

  console.log(`\n  attached ${tally.attached}  created ${tally.created}  left for review ${tally.left}  unreadable ${tally.unreadable}`);
  const open = await prisma.figureCandidate.count({ where: { status: "OPEN" } });
  console.log(`  ${open} candidate(s) still open.`);
  if (!APPLY) console.log("\n  Dry run. Re-run with --yes to apply.");
  console.log("");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
