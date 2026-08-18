import "dotenv/config";
import { prisma } from "../lib/prisma";
import { sameCharacterWithinSeries, splitCharacterNames } from "../lib/ingest/character-guess";

/**
 * Attach every character a figure names, not just the first.
 *
 * derive-characters treats a figure as depicting one character and the parts of
 * a slashed name as competing guesses at it, which is right for
 * "Saber/Altria Pendragon" and wrong for "Asuka/Rei/Mari: Newtype Cover ver." —
 * that one had Asuka and nothing else, and no figure in the catalogue had more
 * than a single character.
 *
 * This runs after it and only widens: each named part is matched against
 * characters already in the catalogue, and every distinct match is connected.
 * Connecting is idempotent, so a figure that already has one keeps it.
 *
 * Matching is scoped to the franchise rather than the series, because the
 * catalogue files a character under whichever series first produced a figure of
 * them. Rei and Mari live under "Rebuild of Evangelion" while this figure is
 * "Evangelion: 3.0+1.0 Thrice Upon a Time" — same franchise, different series,
 * and a series-scoped lookup finds neither.
 *
 * It never invents a character. A part that matches nothing in the franchise is
 * reported and skipped: a name this script cannot place is a name it does not
 * understand, and guessing is how a figure ends up labelled with the wrong
 * person.
 *
 *   npm run derive:multi-characters
 *   npm run derive:multi-characters -- --yes
 */

const APPLY = process.argv.includes("--yes");

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "postgres://unset").hostname;
  console.log(`\n  ${APPLY ? "Applying to" : "Dry run against"} ${host}\n`);

  const figures = await prisma.figure.findMany({
    where: { series: { isNot: null } },
    select: {
      id: true,
      name: true,
      slug: true,
      characters: { select: { id: true, name: true } },
      series: { select: { id: true, franchiseId: true, name: true } },
    },
  });

  // Characters by franchise, so a name can be found wherever it was first filed.
  const characters = await prisma.character.findMany({
    select: {
      id: true,
      name: true,
      aliases: true,
      seriesId: true,
      series: { select: { franchiseId: true } },
    },
  });
  const byFranchise = new Map<string, typeof characters>();
  for (const character of characters) {
    const key = character.series?.franchiseId;
    if (!key) continue;
    byFranchise.set(key, [...(byFranchise.get(key) ?? []), character]);
  }

  let widened = 0;
  let unmatchedParts = 0;
  const examples: string[] = [];

  for (const figure of figures) {
    const parts = splitCharacterNames(figure.name);
    if (parts.length < 2) continue;

    const pool = byFranchise.get(figure.series?.franchiseId ?? "") ?? [];
    const matched = new Map<string, string>();
    const missed: string[] = [];

    for (const part of parts) {
      // The one-word rule is relaxed here because the franchise is already
      // established — the pool is only its characters. That is what sameCharacter
      // withholds by default and for good reason: "Rei" and "Mari" are single
      // words, and matching those against the whole catalogue would be reckless.
      // Against the twelve people in Evangelion it is exactly right.
      const hits = pool.filter(
        (c) =>
          sameCharacterWithinSeries(c.name, part) ||
          c.aliases.some((a) => sameCharacterWithinSeries(a, part)),
      );

      // Grouped by name, not by row. A franchise holds the same character once
      // per series — "Asuka Langley Souryuu" exists three times across the
      // Evangelion series — and counting rows read that as three candidates and
      // refused a name that was never ambiguous.
      const names = new Set(hits.map((c) => c.name.toLowerCase()));

      if (names.size === 1) {
        // Prefer the row filed under this figure's own series, so a figure does
        // not link to the same character as recorded somewhere else.
        const best = hits.find((c) => c.seriesId === figure.series?.id) ?? hits[0]!;
        matched.set(best.id, best.name);
      } else {
        // Two genuinely different people answering to one name. Which is meant
        // cannot be told from here, and picking one is how a figure ends up
        // labelled with the wrong person.
        missed.push(names.size > 1 ? `${part} (matches ${names.size} names)` : part);
      }
    }

    // Two names for one character collapse to one row here, which is exactly
    // how an alias tells itself apart from a cast list.
    if (matched.size < 2) continue;

    const already = new Set(figure.characters.map((c) => c.id));
    const toAdd = [...matched.keys()].filter((id) => !already.has(id));
    if (toAdd.length === 0) continue;

    widened += 1;
    unmatchedParts += missed.length;
    if (examples.length < 8) {
      examples.push(
        `  ${figure.name.slice(0, 46)}\n      has ${figure.characters.map((c) => c.name).join(", ") || "none"}` +
          `\n      add ${toAdd.map((id) => matched.get(id)).join(", ")}` +
          (missed.length ? `\n      no match for ${missed.join(", ")}` : ""),
      );
    }

    if (APPLY) {
      await prisma.figure.update({
        where: { id: figure.id },
        data: { characters: { connect: toAdd.map((id) => ({ id })) } },
      });
    }
  }

  console.log(examples.join("\n\n"));
  console.log(`\n  ${widened} figure(s) would gain a character${APPLY ? " — applied" : ""}`);
  if (unmatchedParts) {
    console.log(`  ${unmatchedParts} named part(s) matched nothing in their franchise and were skipped`);
  }
  console.log(APPLY ? "" : "\n  Dry run. Re-run with --yes to apply.\n");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
