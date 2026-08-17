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

  const figures = await prisma.figure.findMany({
    select: {
      id: true,
      name: true,
      nameJa: true,
      scale: true,
      category: true,
      manufacturer: { select: { name: true } },
      series: { select: { name: true, synonyms: true } },
      characters: { select: { name: true, nameJa: true } },
      // The release number printed on the box — "Nendoroid 1935". The archive
      // records it separately from the name, and it is the only thing telling
      // two catalogue entries with the same name apart.
      identifiers: {
        where: { kind: { in: ["NENDOROID_NO", "FIGMA_NO"] } },
        select: { value: true },
      },
    },
  });

  const rows: MatchCandidate[] = figures.map((f) => ({
    id: f.id,
    name: f.name,
    nameJa: f.nameJa,
    scale: f.scale,
    category: f.category,
    manufacturerName: f.manufacturer?.name ?? null,
    seriesName: f.series?.name ?? null,
    seriesAliases: f.series?.synonyms ?? [],
    characterNames: f.characters.map((c) => c.name),
    characterNamesJa: f.characters.map((c) => c.nameJa).filter((n): n is string => Boolean(n)),
    lineNumber: f.identifiers[0]?.value ?? null,
  }));

  cache = { at: Date.now(), rows };
  return rows;
}
