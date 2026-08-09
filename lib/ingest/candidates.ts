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
      manufacturer: { select: { name: true } },
      series: { select: { name: true } },
      characters: { select: { name: true } },
    },
  });

  const rows: MatchCandidate[] = figures.map((f) => ({
    id: f.id,
    name: f.name,
    nameJa: f.nameJa,
    scale: f.scale,
    manufacturerName: f.manufacturer?.name ?? null,
    seriesName: f.series?.name ?? null,
    characterNames: f.characters.map((c) => c.name),
  }));

  cache = { at: Date.now(), rows };
  return rows;
}
