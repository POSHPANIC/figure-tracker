/**
 * Attach characters to figures that have none.
 *
 *   npm run derive:characters              # dry run
 *   npm run derive:characters -- --yes     # apply
 *   npm run derive:characters -- --limit 50
 *
 * Figures imported from the Good Smile archive arrive with a series but no
 * characters, because the archive has no character field. That leaves them
 * under-constrained for matching — see the note at the top of
 * lib/ingest/character-guess.ts — so this fills the gap.
 *
 * How it decides, in order:
 *
 *   1. Guess candidate names from the product name (pure, tested).
 *   2. Try characters we already hold for that series. Free, and the answer we
 *      most want, since those names are already known-good.
 *   3. Ask AniList for the series' cast and look for a candidate in it.
 *
 * A guess that nothing confirms is dropped and reported, never written.
 * Attaching the wrong character is worse than attaching none: no character
 * leaves the matcher unconstrained, but a wrong one makes it confidently wrong,
 * and a figure quietly wearing somebody else's name is exactly the kind of
 * silent error this catalogue is supposed to not have.
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import {
  characterCandidates,
  sameCharacter,
  sameCharacterWithinSeries,
} from "../lib/ingest/character-guess";
import {
  findCharacters,
  findSeriesCandidates,
  loadMoreCharacters,
  pickBestSeries,
  type AniListCharacter,
  type AniListSeries,
} from "../lib/ingest/anilist";
import { titlesMatchSeries, worksNameThisSeries } from "../lib/ingest/series-dedupe";
import {
  copyrightsFor,
  danbooruConfigured,
  findCharacterTags,
  pickConfirmedTag,
} from "../lib/ingest/danbooru";
import { rebuildSearchTextFor } from "../lib/ingest/search-index";
import { slugify } from "../lib/utils";

const APPLY = process.argv.includes("--yes");
const LIMIT = Number(
  (() => {
    const i = process.argv.indexOf("--limit");
    return i !== -1 ? process.argv[i + 1] : NaN;
  })() ?? NaN,
);

type Resolution = {
  figureId: string;
  figureName: string;
  seriesName: string;
  characterName: string;
  via: "catalogue" | "anilist" | "anilist search" | "danbooru";
  nameJa: string | null;
  aliases: string[];
  anilistId: number | null;
};

type Unresolved = {
  figureName: string;
  seriesName: string | null;
  candidates: string[];
  why: string;
};

/**
 * Resolve one series to its AniList entry, using every character we expect to
 * find in it as the tiebreak.
 *
 * This is why the work is grouped by series rather than done figure by figure.
 * AniList returns five entries for "Amnesia", and with nothing to go on
 * pickBestSeries falls back to popularity — which picks "Tasogare Otome x
 * Amnesia", a completely different show that happens to share a word. Handing
 * it the names we guessed from the product titles ("Ikki") is exactly the
 * signal it was built to use, and it then picks the right one.
 *
 * It also turns one lookup per figure into one per series.
 */
async function resolveSeries(
  seriesName: string,
  expectedCharacters: string[],
): Promise<AniListSeries | null> {
  try {
    const candidates = await findSeriesCandidates(seriesName);
    return pickBestSeries(candidates, expectedCharacters);
  } catch (err) {
    console.warn(
      `  ! AniList lookup failed for "${seriesName}": ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
}


/**
 * Last resort: find the character by name, then check they belong here.
 *
 * Two gates, and both are needed. Searching "Endeavor" also returns "Tera
 * Endeavor" from an unrelated show and a hero called "Endeavorman", so the
 * name has to match properly; and a name can be shared outright across
 * franchises, so the character's own media list has to name the series the
 * figure claims. Either gate alone would eventually attach somebody else.
 *
 * Ambiguity is refused rather than resolved. If two different AniList
 * characters both pass, we do not know which the figure depicts, and guessing
 * is precisely the failure this whole path exists to avoid.
 */
async function searchByName(
  candidates: string[],
  series: { name: string; titleJa: string | null; synonyms: string[]; anilistId: number | null },
) {
  for (const guess of candidates) {
    const cached = nameSearchCache.get(guess.toLowerCase());
    const matches = cached ?? (await findCharacters(guess));
    nameSearchCache.set(guess.toLowerCase(), matches);

    // Series first, deliberately. Only once a character is confirmed to appear
    // in this series is the looser one-word name test safe to apply.
    const plausible = matches
      .filter((c) => titlesMatchSeries(c.media, { id: "", ...series }))
      .filter(
        (c) =>
          sameCharacterWithinSeries(c.name, guess) ||
          c.alternatives.some((a) => sameCharacterWithinSeries(a, guess)),
      );

    const distinct = new Map(plausible.map((c) => [c.id, c]));
    if (distinct.size === 1) return [...distinct.values()][0];
    // Ambiguous. Retire this guess and try the next one rather than giving up
    // on the figure — "Saber" is ambiguous inside Fate where "Saber Alter" is
    // not, and the candidates are ordered roughly vaguest-first.
  }
  return null;
}

/** One lookup per distinct name, however many figures ask for it. */
const nameSearchCache = new Map<string, Awaited<ReturnType<typeof findCharacters>>>();


/**
 * The last resort: Danbooru's character tags.
 *
 * AniList indexes anime and manga. A large part of the figure market is
 * neither — Blue Archive is a game, hololive is a talent agency — and those
 * figures reach here having failed every earlier step. Danbooru tags cover
 * them because that is what its taggers actually tag.
 *
 * The confirmation is the same shape as before and just as necessary. A search
 * for "juri" returns "juri_(blue_archive)" ahead of anything from Street
 * Fighter, so taking the first hit would file a Street Fighter figure under a
 * Blue Archive student. The work has to agree, either from the tag's own
 * bracketed qualifier or from the copyrights Danbooru relates it to, and where
 * two different characters both qualify we say nothing.
 */
async function searchDanbooru(
  candidates: string[],
  series: { name: string; titleJa: string | null; synonyms: string[]; anilistId: number | null },
) {
  for (const guess of candidates) {
    const key = guess.toLowerCase();
    const tags = danbooruCache.get(key) ?? (await findCharacterTags(guess));
    danbooruCache.set(key, tags);
    if (tags.length === 0) continue;

    const nameMatches = (tagName: string) =>
      sameCharacterWithinSeries(guess, tagName) || sameCharacterWithinSeries(tagName, guess);
    const seriesMatches = (works: string[]) =>
      worksNameThisSeries(works, { id: "", ...series });

    // Work out each plausible tag's works. The bracketed qualifier is free;
    // only spend a request on related copyrights when it doesn't settle it.
    const withWorks = [];
    for (const tag of tags.filter((t) => nameMatches(t.name))) {
      const works = seriesMatches(tag.qualifiers)
        ? tag.qualifiers
        : await copyrightsFor(tag.raw);
      withWorks.push({ tag, works });
    }

    const confirmed = pickConfirmedTag(withWorks, nameMatches, seriesMatches);
    if (confirmed) return confirmed;
  }
  return null;
}

/** One lookup per distinct name, however many figures ask for it. */
const danbooruCache = new Map<string, Awaited<ReturnType<typeof findCharacterTags>>>();

async function main() {
  const figures = await prisma.figure.findMany({
    where: { characters: { none: {} } },
    select: {
      id: true,
      name: true,
      series: {
        select: { id: true, name: true, titleJa: true, synonyms: true, anilistId: true },
      },
    },
    orderBy: { createdAt: "asc" },
    ...(Number.isFinite(LIMIT) ? { take: LIMIT } : {}),
  });

  console.log(`figures with no character: ${figures.length}`);
  if (figures.length === 0) {
    console.log("Nothing to do.");
    await prisma.$disconnect();
    return;
  }
  console.log(APPLY ? "APPLYING" : "DRY RUN");
  console.log(
    danbooruConfigured()
      ? "Danbooru fallback: on\n"
      : "Danbooru fallback: off — set DANBOORU_LOGIN and DANBOORU_API_KEY to enable\n",
  );

  // Characters we already hold, grouped by series — checked before spending an
  // AniList call, and a match here is the most trustworthy kind.
  const existing = await prisma.character.findMany({
    select: { id: true, name: true, seriesId: true, aliases: true },
  });
  const bySeries = new Map<string, typeof existing>();
  for (const c of existing) {
    if (!c.seriesId) continue;
    const list = bySeries.get(c.seriesId) ?? [];
    list.push(c);
    bySeries.set(c.seriesId, list);
  }

  const resolved: Resolution[] = [];
  const unresolved: Unresolved[] = [];
  /** How many were only found by paging past AniList's first 25. */
  let deepCastHits = 0;
  /** How many needed the by-name search rather than the series' cast. */
  let nameSearchHits = 0;
  /** How many only Danbooru's tags could account for. */
  let danbooruHits = 0;

  // --- Pass 1: guess, and group the work by series ------------------------
  type Pending = { id: string; name: string; candidates: string[] };
  type SeriesRow = NonNullable<(typeof figures)[number]["series"]>;
  const bySeriesId = new Map<string, { series: SeriesRow; figures: Pending[] }>();

  for (const figure of figures) {
    const candidates = characterCandidates(
      figure.name,
      figure.series
        ? [figure.series.name, ...(figure.series.synonyms ?? []), figure.series.titleJa ?? ""]
        : [],
    );
    if (candidates.length === 0) {
      unresolved.push({
        figureName: figure.name,
        seriesName: figure.series?.name ?? null,
        candidates,
        why: "not one named character",
      });
      continue;
    }
    if (!figure.series) {
      unresolved.push({
        figureName: figure.name,
        seriesName: null,
        candidates,
        why: "figure has no series to check against",
      });
      continue;
    }
    const group = bySeriesId.get(figure.series.id) ?? {
      series: figure.series,
      figures: [],
    };
    group.figures.push({ id: figure.id, name: figure.name, candidates });
    bySeriesId.set(figure.series.id, group);
  }

  console.log(`${bySeriesId.size} series to resolve
`);

  // --- Pass 2: resolve each series once, then match its figures -----------
  for (const [seriesId, group] of bySeriesId) {
    const seriesRow = group.series;
    const known = bySeries.get(seriesId) ?? [];

    // Anyone we already hold needs no lookup at all.
    const stillUnknown: Pending[] = [];
    for (const pending of group.figures) {
      const local = known.find((c) =>
        pending.candidates.some(
          (guess) => sameCharacter(c.name, guess) || c.aliases.some((a) => sameCharacter(a, guess)),
        ),
      );
      if (local) {
        resolved.push({
          figureId: pending.id,
          figureName: pending.name,
          seriesName: seriesRow.name,
          characterName: local.name,
          via: "catalogue",
          nameJa: null,
          aliases: [],
          anilistId: null,
        });
      } else {
        stillUnknown.push(pending);
      }
    }
    if (stillUnknown.length === 0) continue;

    // Every name we guessed for this series, plus the ones we already hold,
    // so AniList picks the entry those people actually appear in.
    const expected = [
      ...known.map((c) => c.name),
      ...stillUnknown.flatMap((p) => p.candidates),
    ];
    const cast = await resolveSeries(seriesRow.name, expected);

    for (const pending of stillUnknown) {
      // AniList has never heard of this series. That rules out its cast and
      // its character search, but not Danbooru — which compares against *our*
      // series name, not AniList's, and is the only source that covers the
      // games and VTuber agencies AniList omits. Ninomae Ina'nis lives here.
      if (!cast) {
        const tag = await searchDanbooru(pending.candidates, seriesRow);
        if (tag) {
          resolved.push({
            figureId: pending.id,
            figureName: pending.name,
            seriesName: seriesRow.name,
            characterName: pending.candidates[0],
            via: "danbooru",
            nameJa: null,
            aliases:
              tag.name.toLowerCase() === pending.candidates[0].toLowerCase() ? [] : [tag.name],
            anilistId: null,
          });
          danbooruHits += 1;
          continue;
        }

        unresolved.push({
          figureName: pending.name,
          seriesName: seriesRow.name,
          candidates: pending.candidates,
          why: "AniList doesn't know this series",
        });
        continue;
      }

      const matches = (c: AniListCharacter) =>
        pending.candidates.some(
          (guess) =>
            sameCharacter(c.name, guess) || c.alternatives.some((a) => sameCharacter(a, guess)),
        );

      let remote = cast.characters.find(matches);

      // Not in the first page of the cast. AniList caps a nested character
      // connection at 25 however many you ask for, and the ordering is by role
      // then popularity — so a figure of someone further down the bill lands
      // here. Page through the rest before giving up, once per series: the
      // extra characters are kept on `cast` so the next figure from the same
      // show pays nothing.
      if (!remote && cast.moreCharacters) {
        const extra = await loadMoreCharacters(cast.id, (found) => found.some(matches));
        if (extra.length > 0) {
          cast.characters.push(...extra);
          cast.moreCharacters = false;
          remote = extra.find(matches);
          if (remote) deepCastHits += 1;
        }
      }

      // Still nothing. AniList files characters per media entry, so someone
      // introduced in a later season is absent from this entry's cast at any
      // page depth — Endeavour is nowhere in Boku no Hero Academia's list, yet
      // AniList knows him as "Enji Todoroki" with "Endeavor" among his other
      // names. Look him up by name instead, and confirm from his own media
      // list that he belongs to this series.
      if (!remote) {
        const found = await searchByName(pending.candidates, seriesRow);
        if (found) {
          resolved.push({
            figureId: pending.id,
            figureName: pending.name,
            seriesName: seriesRow.name,
            characterName: found.name,
            via: "anilist search",
            nameJa: found.native,
            aliases: found.alternatives,
            anilistId: found.id,
          });
          nameSearchHits += 1;
          continue;
        }
      }

      if (!remote) {
        const tag = await searchDanbooru(pending.candidates, seriesRow);
        if (tag) {
          resolved.push({
            figureId: pending.id,
            figureName: pending.name,
            seriesName: seriesRow.name,
            // Our own guess is the better name: it comes off the box, properly
            // cased, and is usually fuller than a lowercase tag. The tag joins
            // the aliases, where it is worth having — people do search "kazusa".
            characterName: pending.candidates[0],
            via: "danbooru",
            nameJa: null,
            aliases: tag.name.toLowerCase() === pending.candidates[0].toLowerCase() ? [] : [tag.name],
            anilistId: null,
          });
          danbooruHits += 1;
          continue;
        }

        unresolved.push({
          figureName: pending.name,
          seriesName: seriesRow.name,
          candidates: pending.candidates,
          why: "no one in the cast matches",
        });
        continue;
      }

      resolved.push({
        figureId: pending.id,
        figureName: pending.name,
        seriesName: seriesRow.name,
        characterName: remote.name,
        via: "anilist",
        nameJa: remote.native,
        aliases: remote.alternatives,
        anilistId: remote.id,
      });
    }
  }

  // --- Report -------------------------------------------------------------

  const viaCatalogue = resolved.filter((r) => r.via === "catalogue").length;
  const viaAniList = resolved.length - viaCatalogue;

  console.log(`${"=".repeat(62)}`);
  console.log(`resolved   : ${resolved.length}  (${viaCatalogue} from the catalogue, ${viaAniList} from AniList)`);
  if (deepCastHits > 0) {
    console.log(`             ${deepCastHits} needed more than AniList's first 25 cast members`);
  }
  if (nameSearchHits > 0) {
    console.log(`             ${nameSearchHits} were absent from the cast and found by name search`);
  }
  if (danbooruHits > 0) {
    console.log(`             ${danbooruHits} were unknown to AniList and confirmed by Danbooru tags`);
  }
  console.log(`unresolved : ${unresolved.length}`);

  if (resolved.length > 0) {
    console.log(`\n--- would attach ---`);
    for (const r of resolved.slice(0, 15)) {
      console.log(`  ${r.figureName.slice(0, 46).padEnd(46)} -> ${r.characterName} (${r.via})`);
    }
    if (resolved.length > 15) console.log(`  …and ${resolved.length - 15} more`);
  }

  if (unresolved.length > 0) {
    const byWhy = new Map<string, Unresolved[]>();
    for (const u of unresolved) {
      const list = byWhy.get(u.why) ?? [];
      list.push(u);
      byWhy.set(u.why, list);
    }
    console.log(`\n--- left alone, and why ---`);
    for (const [why, list] of [...byWhy].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${String(list.length).padStart(4)}  ${why}`);
      for (const u of list.slice(0, 4)) {
        const guess = u.candidates[0] ? `guessed "${u.candidates[0]}"` : "no guess";
        console.log(`        ${u.figureName.slice(0, 44).padEnd(44)} ${guess}`);
      }
    }
  }

  if (!APPLY) {
    console.log(`\nDry run — nothing was written. Re-run with --yes to apply.`);
    console.log(`Read the "would attach" list first: a wrong character is worse than none.`);
    await prisma.$disconnect();
    return;
  }

  // --- Apply --------------------------------------------------------------

  let createdCharacters = 0;
  const touched = new Set<string>();

  for (const r of resolved) {
    const series = await prisma.series.findFirst({
      where: { name: r.seriesName },
      select: { id: true },
    });
    if (!series) continue;

    let character = await prisma.character.findUnique({
      where: { name_seriesId: { name: r.characterName, seriesId: series.id } },
      select: { id: true },
    });

    if (!character) {
      // Character slugs are globally unique, and two series can share a name —
      // there is more than one Saber, and more than one Rin.
      const base = slugify(`${r.characterName}-${r.seriesName}`);
      const taken = await prisma.character.findUnique({
        where: { slug: base },
        select: { id: true },
      });
      character = await prisma.character.create({
        data: {
          name: r.characterName,
          slug: taken ? `${base}-${series.id.slice(-6)}` : base,
          seriesId: series.id,
          nameJa: r.nameJa,
          aliases: r.aliases.filter((a) => a.toLowerCase() !== r.characterName.toLowerCase()),
          anilistId: r.anilistId,
        },
        select: { id: true },
      });
      createdCharacters += 1;
    }

    await prisma.figure.update({
      where: { id: r.figureId },
      data: { characters: { connect: { id: character.id } } },
    });
    touched.add(r.figureId);
  }

  // The link is only reachable through the denormalized search column, so not
  // rebuilding it would store data nothing can find.
  for (const id of touched) await rebuildSearchTextFor(id);

  console.log(`\nAttached characters to ${touched.size} figure(s).`);
  console.log(`Created ${createdCharacters} new character(s); search text rebuilt.`);
  console.log(`Run "npm run rematch" to see what now matches.`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
