/**
 * Collapse Series rows that are the same franchise under different names.
 *
 *   npm run dedupe:series                       # dry run
 *   npm run dedupe:series -- --yes              # apply the conclusive ones
 *   npm run dedupe:series -- --yes --apply-suggested   # …and the suggestions
 *   npm run dedupe:series -- --resolve          # ask AniList about unenriched rows first
 *   npm run dedupe:series -- --merge "Character Vocal Series 01: Hatsune Miku" --into "Hatsune Miku"
 *
 * Good Smile file products under their own series names, so importing their
 * archive splits franchises across rows: "SPY×FAMILY" beside "Spy x Family",
 * "[Oshi no Ko]" beside "Oshi no Ko". Search then finds half a character's
 * figures and browse filters list the same show twice.
 *
 * Run this BEFORE a large import, not after. The work is the same either way,
 * but doing it first means reviewing dozens of suggestions instead of hundreds.
 *
 * Two tiers, on purpose. Rows with conclusive evidence — the same name once
 * styling is ignored, a name that appears in the other's AniList synonyms, or
 * the same AniList entry — merge with --yes. Rows where one name merely
 * contains the other are printed and left alone: that pattern is right often
 * enough to be worth showing and wrong often enough that acting on it would
 * eventually fold Fate/stay night into Fate/Grand Order. Those go through
 * --merge/--into one at a time, or --apply-suggested in bulk once somebody has
 * read the dry run and decided the whole batch is right.
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import {
  CONCLUSIVE,
  groupDuplicates,
  pickCanonical,
  type Evidence,
} from "../lib/ingest/series-dedupe";
import { findSeriesCandidates, pickBestSeries } from "../lib/ingest/anilist";
import { sameCharacter } from "../lib/ingest/character-guess";
import { rebuildSearchTextFor } from "../lib/ingest/search-index";

const APPLY = process.argv.includes("--yes");

/**
 * Also merge the containment suggestions.
 *
 * Off by default because "one name contains the other" is a judgement, not a
 * fact: it is right for "Jujutsu Kaisen 0" against "Jujutsu Kaisen" and wrong
 * for Fate/stay night against Fate/Grand Order. Whoever passes this has read
 * the dry run and decided that, for a catalogue of products rather than a
 * catalogue of shows, a franchise's seasons and films belong together.
 *
 * It applies exactly the groups the dry run printed — no wider rule — so what
 * you saw is what happens.
 */
const APPLY_SUGGESTED = process.argv.includes("--apply-suggested");
const RESOLVE = process.argv.includes("--resolve");

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? (process.argv[i + 1] ?? null) : null;
}

type Row = {
  id: string;
  name: string;
  titleJa: string | null;
  synonyms: string[];
  anilistId: number | null;
  figureCount: number;
};

async function load(): Promise<Row[]> {
  const rows = await prisma.series.findMany({
    select: {
      id: true,
      name: true,
      titleJa: true,
      synonyms: true,
      anilistId: true,
      _count: { select: { figures: true } },
    },
  });
  return rows.map((r) => ({ ...r, figureCount: r._count.figures }));
}

/**
 * Merge `from` into `into`.
 *
 * Order matters. Characters move before figures because a character can only
 * exist once per series, and the same person may already be present under both
 * rows — Rem exists under "Re:Zero" and under "Re:ZERO -Starting Life-". Where
 * that happens the duplicate's figures are handed to the surviving character
 * and the duplicate is deleted; the alternative would break the
 * (name, seriesId) uniqueness constraint halfway through.
 */
async function merge(from: Row, into: Row): Promise<{ figures: number; characters: number }> {
  const survivors = await prisma.character.findMany({
    where: { seriesId: into.id },
    select: { id: true, name: true, aliases: true },
  });
  const moving = await prisma.character.findMany({
    where: { seriesId: from.id },
    select: { id: true, name: true, figures: { select: { id: true } } },
  });

  let charactersMerged = 0;
  for (const character of moving) {
    const survivor = survivors.find(
      (s) => sameCharacter(s.name, character.name) || s.aliases.some((a) => sameCharacter(a, character.name)),
    );

    if (!survivor) {
      await prisma.character.update({
        where: { id: character.id },
        data: { seriesId: into.id },
      });
      survivors.push({ id: character.id, name: character.name, aliases: [] });
      continue;
    }

    // Same person under both rows: give their figures to the survivor, then
    // drop the duplicate. Deleting it clears its figure links too.
    if (character.figures.length > 0) {
      await prisma.character.update({
        where: { id: survivor.id },
        data: { figures: { connect: character.figures.map((f) => ({ id: f.id })) } },
      });
    }
    await prisma.character.delete({ where: { id: character.id } });
    charactersMerged += 1;
  }

  const figures = await prisma.figure.updateMany({
    where: { seriesId: from.id },
    data: { seriesId: into.id },
  });

  // The old name has to survive as a synonym. It is what Good Smile print and
  // what sellers type, so dropping it would make the merged row harder to find
  // than the two rows it replaced.
  const synonyms = new Set([...into.synonyms, ...from.synonyms, from.name]);
  synonyms.delete(into.name);
  await prisma.series.update({
    where: { id: into.id },
    data: {
      synonyms: [...synonyms].filter(Boolean),
      titleJa: into.titleJa ?? from.titleJa,
      anilistId: into.anilistId ?? from.anilistId,
    },
  });

  await prisma.series.delete({ where: { id: from.id } });
  return { figures: figures.count, characters: charactersMerged };
}

/** Rebuild search text for everything now pointing at `seriesId`. */
async function reindexSeries(seriesId: string): Promise<number> {
  const figures = await prisma.figure.findMany({
    where: { seriesId },
    select: { id: true },
  });
  for (const f of figures) await rebuildSearchTextFor(f.id);
  return figures.length;
}

async function main() {
  // --- One-off manual merge ----------------------------------------------
  const fromName = arg("merge");
  const intoName = arg("into");
  if (fromName || intoName) {
    if (!fromName || !intoName) {
      console.error('Both are needed: --merge "Old Name" --into "Kept Name"');
      process.exit(1);
    }
    const rows = await load();
    const from = rows.find((r) => r.name === fromName);
    const into = rows.find((r) => r.name === intoName);
    if (!from || !into) {
      console.error(`No series named "${!from ? fromName : intoName}".`);
      process.exit(1);
    }
    console.log(`"${from.name}" (${from.figureCount} figures) -> "${into.name}" (${into.figureCount})`);
    if (!APPLY) {
      console.log("\nDry run — nothing was written. Add --yes to do it.");
      await prisma.$disconnect();
      return;
    }
    const moved = await merge(from, into);
    const reindexed = await reindexSeries(into.id);
    console.log(`Moved ${moved.figures} figure(s), merged ${moved.characters} character(s).`);
    console.log(`Reindexed ${reindexed} figure(s).`);
    await prisma.$disconnect();
    return;
  }

  // --- Optionally fill in missing AniList IDs first -----------------------
  if (RESOLVE) {
    const unresolved = await prisma.series.findMany({
      where: { anilistId: null },
      select: { id: true, name: true, characters: { select: { name: true } } },
    });
    console.log(`resolving ${unresolved.length} series against AniList…`);
    let found = 0;
    for (const s of unresolved) {
      try {
        const best = pickBestSeries(
          await findSeriesCandidates(s.name),
          s.characters.map((c) => c.name),
        );
        if (!best) continue;
        // Only record the ID. Titles and synonyms are verify-characters' job,
        // and overwriting them here would hide a bad series match behind a
        // plausible-looking row.
        await prisma.series.update({ where: { id: s.id }, data: { anilistId: best.id } });
        found += 1;
      } catch (err) {
        console.warn(`  ! ${s.name}: ${err instanceof Error ? err.message : err}`);
      }
    }
    console.log(`  resolved ${found}/${unresolved.length}\n`);
  }

  const rows = await load();
  console.log(`series: ${rows.length}`);
  console.log(`${APPLY ? "APPLYING" : "DRY RUN"}\n`);

  const conclusive = groupDuplicates(rows, CONCLUSIVE);
  const suggested = groupDuplicates(rows, ["one contains the other"]).filter(
    // Anything already handled above shouldn't be listed twice.
    (g) => !conclusive.some((c) => c.members.some((m) => g.members.some((n) => n.id === m.id))),
  );

  const describe = (g: { members: Row[]; evidence: Evidence }) => {
    const canonical = pickCanonical(g.members);
    const others = g.members.filter((m) => m.id !== canonical.id);
    console.log(`  keep "${canonical.name}" (${canonical.figureCount} figures) — ${g.evidence}`);
    for (const o of others) {
      console.log(`    merge "${o.name}" (${o.figureCount} figures)`);
    }
    return { canonical, others };
  };

  console.log(`--- conclusive (${conclusive.length} group(s)) ---`);
  if (conclusive.length === 0) console.log("  none");
  const planned = conclusive.map(describe);

  console.log(`\n--- suggested, needs a person (${suggested.length} group(s)) ---`);
  if (suggested.length === 0) console.log("  none");
  for (const g of suggested) {
    const canonical = pickCanonical(g.members);
    for (const o of g.members.filter((m) => m.id !== canonical.id)) {
      console.log(`  "${o.name}" (${o.figureCount}) looks like "${canonical.name}" (${canonical.figureCount})`);
      console.log(`      npm run dedupe:series -- --merge "${o.name}" --into "${canonical.name}" --yes`);
    }
  }

  if (!APPLY) {
    console.log(`\nDry run — nothing was written. Re-run with --yes to apply the conclusive ones.`);
    console.log(`Suggestions are never applied automatically; use the command shown.`);
    await prisma.$disconnect();
    return;
  }

  // Exactly the groups printed above — the suggestions are taken as shown, not
  // recomputed under a wider rule, so what was reviewed is what happens.
  const groups = [...planned];
  if (APPLY_SUGGESTED) {
    for (const g of suggested) {
      const canonical = pickCanonical(g.members);
      groups.push({ canonical, others: g.members.filter((m) => m.id !== canonical.id) });
    }
  }

  let figures = 0;
  let characters = 0;
  let reindexed = 0;
  for (const { canonical, others } of groups) {
    for (const other of others) {
      const moved = await merge(other, canonical);
      figures += moved.figures;
      characters += moved.characters;
    }
    reindexed += await reindexSeries(canonical.id);
  }

  console.log(`\nMerged ${groups.length} group(s): moved ${figures} figure(s), merged ${characters} character(s).`);
  console.log(`Reindexed ${reindexed} figure(s).`);
  if (!APPLY_SUGGESTED && suggested.length > 0) {
    console.log(`${suggested.length} suggestion(s) left for you to judge.`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
