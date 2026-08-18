import "dotenv/config";
import { prisma } from "../lib/prisma";
import { candidateKey, identifierKind, readReleaseNumber } from "../lib/ingest/release-number";

/**
 * Find products the catalogue is missing, from listings it could not place.
 *
 *   npm run discover:figures                 # dry run
 *   npm run discover:figures -- --yes        # write candidates
 *   npm run discover:figures -- --min 5      # require more corroboration
 *
 * The Good Smile archive we imported stopped publishing in February 2024, so
 * every release since is absent. Meanwhile the daily eBay poll keeps pulling in
 * listings for those products and finding nothing to attach them to — tens of
 * thousands of them. That pile is not waste; read the other way round it is a
 * list of what the catalogue lacks, gathered by people who had the box in hand.
 *
 * Nothing here creates a figure. It records that several sellers independently
 * named the same release number, keeps their titles verbatim, and leaves the
 * judgement to a person. Marketplace titles are seller shorthand — abbreviated,
 * translated, occasionally wrong — and a price guide that wrote its catalogue
 * from them would be quoting sellers back at themselves.
 */

const APPLY = process.argv.includes("--yes");

function intArg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const raw = i !== -1 ? process.argv[i + 1] : undefined;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * How many separate listings must name a number before it is worth showing.
 *
 * One is a typo. Three people independently typing "Nendoroid 2509" have each
 * read it off a box. Below three the list fills with mis-keyed numbers and the
 * queue stops being worth opening, which is the real failure — a review queue
 * nobody trusts is the same as no queue.
 */
const MIN_LISTINGS = 3;

/** Enough titles to judge by, few enough to read. */
const SAMPLE_TITLES = 4;

const PAGE = 5000;

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "postgres://unset").hostname;
  const min = intArg("min", MIN_LISTINGS);
  console.log(`\n  ${APPLY ? "Writing to" : "Dry run against"} ${host}`);
  console.log(`  Needing ${min} separate listings to agree.\n`);

  // Numbers the catalogue already holds. A candidate is only interesting if it
  // is absent from here — everything else is a matching problem, not a missing
  // product, and those are two different bugs with two different fixes.
  //
  // Both sides are stripped of leading zeros before comparing. The catalogue
  // stores what the archive printed, which pads to three digits — "076" — while
  // a seller writes "figma 76" as often as "figma 076". Comparing the two
  // literally reported figma Sakuya Izayoi as a product we had never heard of,
  // when she is in the catalogue under 076. Every padded number in the
  // catalogue was invisible to this check.
  const known = new Set(
    (
      await prisma.figureIdentifier.findMany({
        where: { kind: { in: ["NENDOROID_NO", "FIGMA_NO"] } },
        select: { kind: true, value: true },
      })
    ).map((r) => `${r.kind}:${/^\d+$/.test(r.value) ? String(Number(r.value)) : r.value}`),
  );
  console.log(`  catalogue holds ${known.size} release numbers`);

  // Counted by distinct listing, not by row: the same eBay item seen on several
  // nights must not look like several sellers agreeing.
  const listings = new Map<string, Set<string>>();
  const titles = new Map<string, string[]>();
  let scanned = 0;

  for (let skip = 0; ; skip += PAGE) {
    const page = await prisma.listing.findMany({
      where: { figureId: null },
      select: { externalId: true, title: true },
      orderBy: { id: "asc" },
      skip,
      take: PAGE,
    });
    if (page.length === 0) break;
    scanned += page.length;

    for (const listing of page) {
      const release = readReleaseNumber(listing.title);
      if (!release) continue;
      if (known.has(`${identifierKind(release.line)}:${release.number}`)) continue;

      const key = candidateKey(release);
      if (!listings.has(key)) {
        listings.set(key, new Set());
        titles.set(key, []);
      }
      listings.get(key)!.add(listing.externalId);
      const seen = titles.get(key)!;
      if (seen.length < SAMPLE_TITLES && !seen.includes(listing.title)) seen.push(listing.title);
    }
  }

  console.log(`  scanned ${scanned} listings attached to no figure`);
  console.log(`  found ${listings.size} unknown release numbers\n`);

  const found = [...listings.entries()]
    .filter(([, ids]) => ids.size >= min)
    .sort((a, b) => b[1].size - a[1].size);

  if (found.length === 0) {
    console.log("  Nothing corroborated. Done.\n");
    await prisma.$disconnect();
    return;
  }

  // Already judged. A dismissed candidate stays dismissed however many more
  // listings turn up for it, or the same rejection lands every night.
  const judged = new Set(
    (
      await prisma.figureCandidate.findMany({
        where: { status: { in: ["ACCEPTED", "DISMISSED"] } },
        select: { key: true },
      })
    ).map((c) => c.key),
  );

  const fresh = found.filter(([key]) => !judged.has(key));
  console.log(`  ${found.length} corroborated, ${found.length - fresh.length} already judged\n`);

  for (const [key, ids] of fresh.slice(0, 15)) {
    console.log(`  ${key.padEnd(16)} ${String(ids.size).padStart(3)} listings   ${titles.get(key)![0]?.slice(0, 58)}`);
  }
  if (fresh.length > 15) console.log(`  … and ${fresh.length - 15} more`);

  if (!APPLY) {
    console.log(`\n  Dry run. Re-run with --yes to record ${fresh.length} candidate(s).\n`);
    await prisma.$disconnect();
    return;
  }

  for (const [key, ids] of fresh) {
    const [line, number] = key.split(":") as [string, string];
    await prisma.figureCandidate.upsert({
      where: { key },
      // Counts move as listings come and go, so an existing candidate is
      // refreshed rather than left at whatever it was first seen at.
      update: { listingCount: ids.size, sampleTitles: titles.get(key)! },
      create: { key, line, number, listingCount: ids.size, sampleTitles: titles.get(key)! },
    });
  }

  const open = await prisma.figureCandidate.count({ where: { status: "OPEN" } });
  console.log(`\n  Recorded. ${open} candidate(s) now waiting for review.\n`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
