import { prisma } from "../prisma";
import { buildSearchText } from "../search-text";

/**
 * Maintains Figure.searchText.
 *
 * Catalogue metadata changes rarely — a figure's series and cast don't move —
 * so this runs from the nightly job and after any bulk metadata change rather
 * than on every read.
 */

const figureSelect = {
  id: true,
  name: true,
  nameJa: true,
  nameJaReading: true,
  identifiers: {
    where: { kind: { in: ["NENDOROID_NO", "FIGMA_NO"] as string[] } },
    select: { value: true },
  },
  scale: true,
  manufacturer: { select: { name: true } },
  series: { select: { name: true, titleJa: true, synonyms: true } },
  characters: { select: { name: true, nameJa: true, aliases: true } },
} as const;

type FigureRow = {
  id: string;
  name: string;
  nameJa: string | null;
  nameJaReading: string | null;
  identifiers: { value: string }[];
  scale: string | null;
  manufacturer: { name: string } | null;
  series: { name: string; titleJa: string | null; synonyms: string[] } | null;
  characters: { name: string; nameJa: string | null; aliases: string[] }[];
};

function textFor(figure: FigureRow): string {
  return buildSearchText({
    name: figure.name,
    nameJa: figure.nameJa,
    nameJaReading: figure.nameJaReading,
    releaseNumber: figure.identifiers[0]?.value ?? null,
    scale: figure.scale,
    manufacturerName: figure.manufacturer?.name,
    seriesName: figure.series?.name,
    seriesTitleJa: figure.series?.titleJa,
    seriesSynonyms: figure.series?.synonyms,
    characters: figure.characters,
  });
}

/** Rebuild one figure's search text. Call after editing its metadata. */
export async function rebuildSearchTextFor(figureId: string): Promise<void> {
  const figure = await prisma.figure.findUnique({
    where: { id: figureId },
    select: figureSelect,
  });
  if (!figure) return;

  await prisma.figure.update({
    where: { id: figureId },
    data: { searchText: textFor(figure) },
  });
}

/**
 * Rebuild every figure's search text. Returns how many actually changed, so a
 * routine nightly run is quiet and a real change is visible.
 */
export async function rebuildAllSearchText(): Promise<number> {
  const figures = await prisma.figure.findMany({
    select: { ...figureSelect, searchText: true },
  });

  let updated = 0;
  for (const figure of figures) {
    const next = textFor(figure);
    if (figure.searchText === next) continue;

    await prisma.figure.update({ where: { id: figure.id }, data: { searchText: next } });
    updated += 1;
  }

  return updated;
}
