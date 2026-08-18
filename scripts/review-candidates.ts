import "dotenv/config";
import { prisma } from "../lib/prisma";

/**
 * Print the open candidates with whatever the catalogue already knows.
 *
 *   npm run review:candidates
 *
 * Reviewing 83 of these in a web page means 83 searches typed by hand to answer
 * the one question that decides each of them: is this product already listed
 * without its number? Only 3,085 of 7,068 figures carry a number, so that is a
 * real possibility for every row, and the first accept we tried created a
 * duplicate. This does those searches in one pass so the queue can be worked
 * through with the answers already attached.
 *
 * Reads only. Nothing here decides anything.
 */

/**
 * Words that appear in marketplace titles regardless of what is being sold.
 * Stripping them leaves the part that identifies the product — usually a
 * character and a series.
 */
const NOISE = new Set([
  "good", "smile", "company", "gsc", "max", "factory", "nendoroid", "figma",
  "figure", "figures", "action", "new", "used", "sealed", "authentic", "authen",
  "genuine", "official", "japan", "japanese", "import", "usa", "us", "seller",
  "ship", "shipping", "free", "fast", "from", "with", "and", "the", "ver",
  "version", "no", "pvc", "anime", "toy", "collectible", "bonus", "base",
  "in", "box", "nib", "misb", "rare", "limited", "edition", "dx", "set",
  "preorder", "pre", "order", "brand", "unopened", "product", "item", "of",
  "collection", "collectable", "statue", "model", "doll", "cm", "inch",
]);

function subjectTokens(titles: string[]): string[] {
  const counts = new Map<string, number>();
  for (const title of titles) {
    const seen = new Set(
      title
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !NOISE.has(w) && !/^\d+$/.test(w)),
    );
    for (const word of seen) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  // A word several sellers used describes the product; a word one seller used
  // describes that seller.
  const threshold = titles.length >= 3 ? 2 : 1;
  return [...counts.entries()]
    .filter(([, n]) => n >= threshold)
    .sort((a, b) => b[1] - a[1])
    .map(([w]) => w)
    .slice(0, 4);
}

async function main() {
  const candidates = await prisma.figureCandidate.findMany({
    where: { status: "OPEN" },
    orderBy: [{ listingCount: "desc" }],
  });

  console.log(`\n  ${candidates.length} candidates open\n`);

  for (const candidate of candidates) {
    const line = candidate.line === "FIGMA" ? "figma" : "Nendoroid";
    const tokens = subjectTokens(candidate.sampleTitles);

    // Every token must appear, so a two-word character name narrows properly
    // instead of returning everything sharing a first name.
    const matches = tokens.length
      ? await prisma.figure.findMany({
          where: {
            AND: tokens.map((t) => ({ searchText: { contains: t } })),
          },
          select: {
            name: true,
            slug: true,
            category: true,
            identifiers: { select: { value: true } },
          },
          take: 3,
        })
      : [];

    console.log(`${line} ${candidate.number}   (${candidate.listingCount} listings)`);
    console.log(`   sellers say : ${candidate.sampleTitles[0]?.slice(0, 72)}`);
    console.log(`   subject     : ${tokens.join(" ") || "(unclear)"}`);

    if (matches.length === 0) {
      console.log(`   catalogue   : nothing like it — likely genuinely missing`);
    } else {
      for (const m of matches) {
        const numbers = m.identifiers.map((i) => i.value).join(",");
        const sameLine = m.category === candidate.line;
        console.log(
          `   catalogue   : ${sameLine ? "SAME LINE" : "other line"}  ${m.name.slice(0, 46)}` +
            `  [${numbers || "no number"}]  ${m.slug}`,
        );
      }
    }
    console.log("");
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
