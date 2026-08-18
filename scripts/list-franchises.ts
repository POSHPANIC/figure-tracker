import "dotenv/config";
import { prisma } from "../lib/prisma";
import { FRANCHISES } from "../lib/franchises";

/**
 * Write out every franchise, for curating by hand.
 *
 *   npm run list:franchises > franchises.md
 *
 * Most of these are not really franchises. `assign-franchises` promotes any
 * series nobody has grouped into a franchise of its own, so the browse filter
 * currently offers about fourteen hundred entries, most holding a single
 * series — which is the honest state for a series nobody has looked at, but
 * makes the filter long and scatters things that belong together.
 *
 * Curating means moving names out of the long tail and into the list in
 * lib/franchises.ts. This is the working document for that.
 *
 * The "possibly related" section at the end is a hint and nothing more. A
 * shared word is not a shared origin: this catalogue holds Demon Slayer and
 * Demon's Souls, Love Live! and To Love-Ru, The Legend of Zelda and The Legend
 * of Hei. Every suggestion needs a person who knows the shows.
 */

/** Words too common to say anything about what two names have in common. */
const COMMON = new Set([
  "the", "of", "and", "a", "an", "no", "ni", "wa", "wo", "de", "ga", "to",
  "in", "on", "for", "my", "your", "you", "we", "it", "is", "not", "season",
  "ver", "version", "movie", "series", "collection", "girls", "girl", "boys",
  "boy", "story", "world", "life", "love", "days", "days", "new", "gekijouban",
  "part", "final", "first", "second", "third", "anime", "tv", "ova", "special",
]);

function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !COMMON.has(w));
}

async function main() {
  const rows = await prisma.franchise.findMany({
    select: {
      name: true,
      slug: true,
      series: { select: { name: true, _count: { select: { figures: true } } } },
    },
  });

  const franchises = rows
    .map((f) => ({
      name: f.name,
      slug: f.slug,
      seriesCount: f.series.length,
      seriesNames: f.series.map((s) => s.name),
      figures: f.series.reduce((n, s) => n + s._count.figures, 0),
    }))
    .filter((f) => f.figures > 0)
    .sort((a, b) => b.figures - a.figures || a.name.localeCompare(b.name));

  const curated = new Set(FRANCHISES.map((f) => f.name));
  const grouped = franchises.filter((f) => f.seriesCount > 1);
  const singles = franchises.filter((f) => f.seriesCount === 1);

  console.log("# Franchises\n");
  console.log(`${franchises.length} franchises holding figures.`);
  console.log(`${curated.size} curated by hand in \`lib/franchises.ts\`.`);
  console.log(`${grouped.length} hold more than one series; ${singles.length} hold exactly one.\n`);
  console.log("A franchise holding one series is usually one nobody has curated yet, not a");
  console.log("statement that the series stands alone. Those are the rows worth reading.\n");

  console.log("## Holding more than one series\n");
  console.log("| Figures | Franchise | Series |");
  console.log("| ---: | --- | --- |");
  for (const f of grouped) {
    const mark = curated.has(f.name) ? " ✓" : "";
    console.log(`| ${f.figures} | ${f.name}${mark} | ${f.seriesNames.join(" · ")} |`);
  }

  console.log("\n✓ marks the ones already written into `lib/franchises.ts`.\n");

  console.log("## Holding one series\n");
  console.log("Ordered by size. The big ones at the top are where curation pays.\n");
  console.log("| Figures | Franchise |");
  console.log("| ---: | --- |");
  for (const f of singles) {
    console.log(`| ${f.figures} | ${f.name}${curated.has(f.name) ? " ✓" : ""} |`);
  }

  // Names sharing an uncommon word. Cheap to compute, wrong often enough that
  // it can only ever be a prompt to look.
  const byToken = new Map<string, string[]>();
  for (const f of singles) {
    for (const token of new Set(tokens(f.name))) {
      if (!byToken.has(token)) byToken.set(token, []);
      byToken.get(token)!.push(f.name);
    }
  }

  const clusters = [...byToken.entries()]
    .filter(([, names]) => names.length > 1 && names.length <= 12)
    .sort((a, b) => b[1].length - a[1].length);

  console.log("\n## Possibly related, worth a look\n");
  console.log("Franchises whose names share an uncommon word. **This is a hint, not a**");
  console.log("**finding.** A shared word is not a shared origin — this catalogue holds Demon");
  console.log("Slayer and Demon's Souls, Love Live! and To Love-Ru. Check each one.\n");
  for (const [token, names] of clusters) {
    console.log(`- **${token}** — ${names.join(" · ")}`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
