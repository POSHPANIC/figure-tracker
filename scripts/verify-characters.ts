/**
 * Check the seeded catalogue against AniList.
 *
 * The character names in this database were typed by hand, and the matcher
 * gates on them — a misspelled character name silently stops every listing for
 * that figure from matching. This reports, per series:
 *
 *   ✓  characters AniList confirms
 *   ?  characters AniList has never heard of (suspect a typo, or a game/manga
 *      character that isn't in the anime)
 *   +  main characters AniList knows that we don't have yet
 *
 * Read-only by default. Pass --write to apply the safe corrections.
 *
 *   npm run verify:characters
 *   npm run verify:characters -- --write
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import {
  findSeries,
  namesMatch,
  type AniListCharacter,
  type AniListSeries,
} from "../lib/ingest/anilist";

const WRITE = process.argv.includes("--write");

type Finding = {
  series: string;
  anilistTitle: string | null;
  remote: AniListSeries | null;
  confirmed: { ours: string; theirs: AniListCharacter }[];
  unknown: string[];
  missingMains: AniListCharacter[];
};

async function main() {
  const series = await prisma.series.findMany({
    include: { characters: { select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  });

  console.log(`Checking ${series.length} series against AniList…`);
  console.log("(throttled to stay inside their 30/min limit — this takes a moment)\n");

  const findings: Finding[] = [];

  for (const s of series) {
    // Pass our known cast so the right series is chosen from the candidates —
    // "Demon Slayer" otherwise resolves to an unrelated show called "Onigiri".
    const remote = await findSeries(
      s.name,
      s.characters.map((c) => c.name),
    );

    if (!remote) {
      console.log(`✗ ${s.name} — not found on AniList`);
      findings.push({
        series: s.name,
        anilistTitle: null,
        remote: null,
        confirmed: [],
        unknown: s.characters.map((c) => c.name),
        missingMains: [],
      });
      continue;
    }

    const confirmed: Finding["confirmed"] = [];
    const unknown: string[] = [];

    for (const ours of s.characters) {
      const theirs = remote.characters.find(
        (c) =>
          namesMatch(c.name, ours.name) ||
          c.alternatives.some((alt) => namesMatch(alt, ours.name)),
      );
      if (theirs) confirmed.push({ ours: ours.name, theirs });
      else unknown.push(ours.name);
    }

    // Only main characters are worth flagging as missing — a figure line rarely
    // reaches the background cast, and listing all of them would be noise.
    const haveNames = new Set(s.characters.map((c) => c.name));
    const missingMains = remote.characters.filter(
      (c) =>
        c.role === "MAIN" &&
        !haveNames.has(c.name) &&
        !confirmed.some((m) => m.theirs.id === c.id),
    );

    const title = remote.titleEnglish ?? remote.titleRomaji;
    console.log(`${unknown.length === 0 ? "✓" : "!"} ${s.name}${title && title !== s.name ? `  →  ${title}` : ""}`);
    for (const c of confirmed) {
      const extras = [c.theirs.native, ...c.theirs.alternatives].filter(Boolean);
      console.log(`    ✓ ${c.ours}${extras.length ? `  (also: ${extras.join(", ")})` : ""}`);
    }
    for (const name of unknown) console.log(`    ? ${name} — not found in this series on AniList`);
    for (const c of missingMains) console.log(`    + ${c.name} — main character we don't have`);

    findings.push({
      series: s.name,
      anilistTitle: title,
      remote,
      confirmed,
      unknown,
      missingMains,
    });
  }

  // --- Summary ---------------------------------------------------------
  const totalOurs = findings.reduce((n, f) => n + f.confirmed.length + f.unknown.length, 0);
  const totalConfirmed = findings.reduce((n, f) => n + f.confirmed.length, 0);
  const totalUnknown = findings.reduce((n, f) => n + f.unknown.length, 0);
  const withNative = findings.reduce(
    (n, f) => n + f.confirmed.filter((c) => c.theirs.native).length,
    0,
  );
  const totalAliases = findings.reduce(
    (n, f) => n + f.confirmed.reduce((m, c) => m + c.theirs.alternatives.length, 0),
    0,
  );

  console.log("\n" + "─".repeat(60));
  console.log(`characters in our catalogue : ${totalOurs}`);
  console.log(`confirmed by AniList        : ${totalConfirmed}`);
  console.log(`unrecognised                : ${totalUnknown}`);
  console.log(`with a Japanese name available: ${withNative}`);
  console.log(`extra aliases available     : ${totalAliases}`);

  if (!WRITE) {
    console.log("\nRead-only. Re-run with --write to store the Japanese names and aliases.");
    await prisma.$disconnect();
    return;
  }

  // --- Apply -----------------------------------------------------------
  // Only enriches what's already there. Characters AniList doesn't recognise
  // are left alone rather than guessed at, and the missing mains are reported
  // rather than created — deciding which characters belong in a *figure*
  // catalogue is an editorial call, not something to infer from an anime cast.
  console.log("\nWriting…");
  let charactersUpdated = 0;
  let seriesUpdated = 0;

  for (const f of findings) {
    if (!f.remote) continue;

    await prisma.series.updateMany({
      where: { name: f.series },
      data: {
        titleJa: f.remote.titleNative,
        synonyms: dedupe([
          f.remote.titleRomaji,
          f.remote.titleEnglish,
          ...f.remote.synonyms,
        ]).filter((t) => t.toLowerCase() !== f.series.toLowerCase()),
        anilistId: f.remote.id,
      },
    });
    seriesUpdated += 1;

    for (const { ours, theirs } of f.confirmed) {
      await prisma.character.updateMany({
        where: { name: ours, series: { name: f.series } },
        data: {
          nameJa: theirs.native,
          aliases: dedupe(theirs.alternatives).filter(
            (a) => a.toLowerCase() !== ours.toLowerCase(),
          ),
          anilistId: theirs.id,
        },
      });
      charactersUpdated += 1;
    }
  }

  console.log(`  ${seriesUpdated} series and ${charactersUpdated} characters enriched`);
  console.log("  Japanese names now feed the matcher; aliases are stored for search.");

  await prisma.$disconnect();
}

function dedupe(values: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const trimmed = v?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
