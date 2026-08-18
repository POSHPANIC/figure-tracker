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
