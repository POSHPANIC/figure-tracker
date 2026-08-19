import "server-only";
import { prisma } from "./prisma";

/**
 * Options for the browse filters, in two forms.
 *
 * The lists are far too long to send whole: 1,403 franchises and 2,083
 * characters put the browse page at 1.5MB, most of it names nobody scrolled
 * to. But capping the list and filtering it in the browser is worse than it
 * looks — the tail is not merely hidden, it is unreachable, because typing an
 * exact name searches only what was loaded.
 *
 * So the page ships a head for browsing, ordered by how many figures each
 * holds, and typing asks the database. That is the only arrangement where the
 * common case is instant and the rare one is still possible.
 */

/** How many of each to send with the page. Enough to browse, not to exhaust. */
export const FILTER_HEAD = 60;

export type FilterOption = { name: string; slug: string; count: number };
export type FilterKind = "franchise" | "character" | "manufacturer";

export const FILTER_KINDS: FilterKind[] = ["franchise", "character", "manufacturer"];

/**
 * A franchise's figures belong to its series, so the count is a sum rather
 * than a column — which is why this cannot be ordered or limited by the
 * database and is done here instead.
 */
async function franchiseOptions(query: string, take: number): Promise<FilterOption[]> {
  const rows = await prisma.franchise.findMany({
    where: query ? { name: { contains: query, mode: "insensitive" } } : undefined,
    select: { name: true, slug: true, series: { select: { _count: { select: { figures: true } } } } },
  });
  return rows
    .map((f) => ({
      name: f.name,
      slug: f.slug,
      count: f.series.reduce((n, s) => n + s._count.figures, 0),
    }))
    .filter((f) => f.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, take);
}

export async function filterOptions(
  kind: FilterKind,
  query = "",
  take = FILTER_HEAD,
): Promise<FilterOption[]> {
  if (kind === "franchise") return franchiseOptions(query, take);

  const where = query ? { name: { contains: query, mode: "insensitive" as const } } : undefined;
  const args = {
    where,
    select: { name: true, slug: true, _count: { select: { figures: true } } },
    orderBy: [{ figures: { _count: "desc" as const } }, { name: "asc" as const }],
    take,
  };

  const rows =
    kind === "character"
      ? await prisma.character.findMany(args)
      : await prisma.manufacturer.findMany(args);

  return rows
    .map((r) => ({ name: r.name, slug: r.slug, count: r._count.figures }))
    .filter((r) => r.count > 0);
}

/** A filter the visitor could jump to, rather than a figure. */
export type EntityMatch = FilterOption & { kind: FilterKind };

/** How many filters the header search offers before the figures start. */
const ENTITY_MATCHES = 5;

/**
 * The filters worth offering for a half-typed query.
 *
 * Typing "Hats" in the header used to return Hatsune Miku figures ranked by
 * sales, and never Hatsune Miku herself — so the way to see all 215 of her was
 * to open browse and use the filter panel, which is a second place to search
 * and not an obvious one. These rows are the shortcut.
 *
 * Ranked prefix-first and then by size, because a query is nearly always the
 * start of a name: "Good" should reach Good Smile Company ahead of the larger
 * catalogue entries that merely contain the word.
 */
export async function entityMatches(query: string, take = ENTITY_MATCHES): Promise<EntityMatch[]> {
  const q = query.trim();
  // Same floor the typeahead uses. One letter matches too much of a catalogue
  // this size to be a suggestion.
  if (q.length < 2) return [];

  const perKind = await Promise.all(
    FILTER_KINDS.map(async (kind) =>
      (await filterOptions(kind, q, take)).map((o) => ({ ...o, kind })),
    ),
  );

  const lower = q.toLowerCase();
  return perKind
    .flat()
    .sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(lower);
      const bStarts = b.name.toLowerCase().startsWith(lower);
      if (aStarts !== bStarts) return aStarts ? -1 : 1;
      return b.count - a.count || a.name.localeCompare(b.name);
    })
    .slice(0, take);
}

/** What the active filters are called, for showing them back to the reader. */
export type ActiveFilterNames = {
  franchise?: string;
  character?: string;
  manufacturer?: string;
};

/**
 * Resolve the slugs in the URL to names a person would recognise.
 *
 * Needed because the panel only ships the busiest 60 of each kind, and a
 * filtered franchise is frequently not among them — anything outside the head
 * would otherwise be labelled with its slug, which is the one form of the name
 * nobody types or reads.
 */
export async function activeFilterNames(slugs: {
  franchise?: string;
  character?: string;
  manufacturer?: string;
}): Promise<ActiveFilterNames> {
  const [franchise, character, manufacturer] = await Promise.all([
    slugs.franchise
      ? prisma.franchise.findUnique({ where: { slug: slugs.franchise }, select: { name: true } })
      : null,
    slugs.character
      ? prisma.character.findUnique({ where: { slug: slugs.character }, select: { name: true } })
      : null,
    slugs.manufacturer
      ? prisma.manufacturer.findUnique({ where: { slug: slugs.manufacturer }, select: { name: true } })
      : null,
  ]);

  return {
    ...(franchise ? { franchise: franchise.name } : {}),
    ...(character ? { character: character.name } : {}),
    ...(manufacturer ? { manufacturer: manufacturer.name } : {}),
  };
}
