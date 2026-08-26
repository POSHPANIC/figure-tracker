import { prisma } from "../prisma";
import type { MatchCandidate } from "./match";

/**
 * Loads the catalog in the shape the matcher wants.
 *
 * Split out from match.ts so the scoring functions stay pure and testable
 * without a database.
 */

let cache: { at: number; rows: MatchCandidate[] } | null = null;
const TTL_MS = 5 * 60_000;

export async function loadCandidates(force = false): Promise<MatchCandidate[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.rows;

  // Two flat queries rather than one with a nested relation.
  //
  // Loading the identifiers as a nested select made Prisma fetch them with an
  // IN list of all seven thousand figure ids, and the local development
  // database refuses that: "bind message supplies 7069 parameters, but
  // prepared statement requires 7071". Hosted Postgres accepts it, so this
  // only broke locally — the worst place for it, since that is where matching
  // gets changed. Reading the whole table and joining in memory is a few
  // thousand rows and no parameters at all.
  const [figures, releaseNumbers] = await Promise.all([
    prisma.figure.findMany({
      // A reissue folded into the product it reissues is not a separate thing
      // to match against — it is the same figure with a later date, and the
      // whole reason it was folded is that no seller's title can tell the two
      // apart. Leaving it here would keep the tie that bestMatch refuses to
      // guess at, which is what sent those listings nowhere.
      where: { supersededById: null },
      select: {
        id: true,
        name: true,
        nameJa: true,
        scale: true,
        heightMm: true,
        category: true,
        manufacturer: { select: { name: true } },
        series: { select: { name: true, synonyms: true, franchise: { select: { name: true } } } },
        characters: { select: { name: true, nameJa: true } },
      },
    }),
    // The number printed on the box — "Nendoroid 1935". Recorded apart from
    // the name, and often the only thing telling two catalogue entries with
    // the same name apart.
    prisma.figureIdentifier.findMany({
      where: { kind: { in: ["NENDOROID_NO", "FIGMA_NO"] } },
      select: { figureId: true, value: true },
    }),
  ]);

  const numberOf = new Map(releaseNumbers.map((r) => [r.figureId, r.value]));

  const rows: MatchCandidate[] = figures.map((f) => ({
    id: f.id,
    name: f.name,
    nameJa: f.nameJa,
    scale: f.scale,
    heightMm: f.heightMm,
    category: f.category,
    manufacturerName: f.manufacturer?.name ?? null,
    seriesName: f.series?.name ?? null,
    seriesAliases: f.series?.synonyms ?? [],
    franchiseName: f.series?.franchise?.name ?? null,
    characterNames: f.characters.map((c) => c.name),
    characterNamesJa: f.characters.map((c) => c.nameJa).filter((n): n is string => Boolean(n)),
    lineNumber: numberOf.get(f.id) ?? null,
  }));

  cache = { at: Date.now(), rows };
  return rows;
}
