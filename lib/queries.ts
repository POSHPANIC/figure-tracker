import "server-only";
import { cacheLife } from "next/cache";
import { prisma } from "./prisma";
import { dayValue, type ValueBasis } from "./figure-value";
import { filterOptions } from "./filter-options";
import { normalizeQuery } from "./search-text";
import type { Prisma } from "./generated/prisma/client";
import type { FigureCategory, ItemCondition } from "./generated/prisma/enums";

/**
 * All read paths for the public site live here, so page components stay
 * about layout and there's one place to look when a query needs an index.
 */

/** Shape every figure card renders from. */
export const figureCardSelect = {
  id: true,
  slug: true,
  name: true,
  category: true,
  status: true,
  scale: true,
  releaseDate: true,
  primaryImageUrl: true,
  marketValueUsd: true,
  change30dPct: true,
  salesVolume90d: true,
  // Shown when there is no market value, which is currently every figure.
  askMedianUsd: true,
  askListings: true,
  manufacturer: { select: { name: true, slug: true } },
  // The card shows the franchise, but the series is still selected and still
  // stored — nothing about this grouping is destructive, and showing the series
  // again is a one-line change in figure-card.tsx.
  series: {
    select: { name: true, slug: true, franchise: { select: { name: true, slug: true } } },
  },
} satisfies Prisma.FigureSelect;

export type FigureCard = Prisma.FigureGetPayload<{ select: typeof figureCardSelect }>;

export type SortKey = "trending" | "value-desc" | "value-asc" | "newest" | "name";

// Sorting by value falls through to the asking price, because market value is
// null on every figure and a sort on it currently orders nothing. Whichever
// number the card shows is the one it sorts by, which is the only arrangement
// where the order matches what a person is reading.
const ORDER_BY: Record<SortKey, Prisma.FigureOrderByWithRelationInput[]> = {
  trending: [{ change30dPct: "desc" }, { salesVolume90d: "desc" }],
  "value-desc": [
    { marketValueUsd: { sort: "desc", nulls: "last" } },
    { askMedianUsd: { sort: "desc", nulls: "last" } },
  ],
  "value-asc": [
    { marketValueUsd: { sort: "asc", nulls: "last" } },
    { askMedianUsd: { sort: "asc", nulls: "last" } },
  ],
  newest: [{ releaseDate: "desc" }],
  name: [{ name: "asc" }],
};

export type FigureFilters = {
  q?: string;
  category?: FigureCategory;
  seriesSlug?: string;
  franchiseSlug?: string;
  characterSlug?: string;
  manufacturerSlug?: string;
  minUsd?: number;
  maxUsd?: number;
  sort?: SortKey;
  page?: number;
  perPage?: number;
};

function buildWhere(f: FigureFilters): Prisma.FigureWhereInput {
  // A folded reissue is the same product as the entry it points at, so listing
  // both would show the reader the same figure twice — once with the listings
  // and once without.
  const where: Prisma.FigureWhereInput = { supersededById: null };

  if (f.q?.trim()) {
    const q = normalizeQuery(f.q);
    // One indexed column rather than five OR'd joins. searchText is stored
    // lowercase, so no `mode: "insensitive"` — that forces a sequential scan.
    //
    // It also reaches things the joins couldn't: character aliases and series
    // synonyms live in Postgres arrays, and Prisma has no partial match for
    // array elements, so "Saber" could never find Altria Pendragon before.
    where.OR = [
      { searchText: { contains: q } },
      // Safety net for a figure created since the last index rebuild.
      { name: { contains: q, mode: "insensitive" } },
    ];
  }
  if (f.category) where.category = f.category;
  // Franchise reaches a figure through its series, so the two combine into one
  // clause rather than competing: choosing a franchise and then a series inside
  // it narrows, as you would expect from two filters.
  if (f.seriesSlug || f.franchiseSlug) {
    where.series = {
      ...(f.seriesSlug ? { slug: f.seriesSlug } : {}),
      ...(f.franchiseSlug ? { franchise: { slug: f.franchiseSlug } } : {}),
    };
  }
  if (f.manufacturerSlug) where.manufacturer = { slug: f.manufacturerSlug };
  // Many-to-many: a figure can depict several characters, and one of them
  // matching is what the filter means.
  if (f.characterSlug) where.characters = { some: { slug: f.characterSlug } };
  if (f.minUsd !== undefined || f.maxUsd !== undefined) {
    where.marketValueUsd = {
      ...(f.minUsd !== undefined ? { gte: f.minUsd } : {}),
      ...(f.maxUsd !== undefined ? { lte: f.maxUsd } : {}),
    };
  }
  return where;
}

/**
 * How long a catalogue query may be reused.
 *
 * The catalogue changes when ingestion runs, which is nightly, so an hour is
 * already far fresher than the data behind it. What it buys is that a crawler
 * walking the browse pages does not re-run the same query for every request —
 * which is how the site came to spend three of its four allowed CPU-hours.
 */
function catalogueCacheLife() {
  cacheLife({ stale: 300, revalidate: 3600, expire: 86_400 });
}

export async function searchFigures(filters: FigureFilters) {
  "use cache";
  catalogueCacheLife();

  const perPage = Math.min(filters.perPage ?? 24, 60);
  const page = Math.max(filters.page ?? 1, 1);
  const where = buildWhere(filters);

  const [items, total] = await Promise.all([
    prisma.figure.findMany({
      where,
      select: figureCardSelect,
      orderBy: ORDER_BY[filters.sort ?? "trending"],
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.figure.count({ where }),
  ]);

  return { items, total, page, perPage, pageCount: Math.max(1, Math.ceil(total / perPage)) };
}

/** Typeahead for the header search box. */
export async function quickSearch(q: string, limit = 8) {
  if (!q.trim()) return [];
  return prisma.figure.findMany({
    where: buildWhere({ q }),
    select: {
      slug: true,
      name: true,
      marketValueUsd: true,
      // Selected because market value is null on every figure, so the asking
      // median is the number a suggestion actually shows.
      askMedianUsd: true,
      askListings: true,
      // The franchise, because that is what browsing is by now — a result
      // labelled "Evangelion: 2.0" points at a filter the site no longer
      // offers.
      series: { select: { franchise: { select: { name: true } } } },
    },
    orderBy: [{ salesVolume90d: "desc" }],
    take: limit,
  });
}

/**
 * One figure, with the listings for the condition being looked at.
 *
 * The condition tabs used to move the chart and the lowest-ask figure while the
 * listings below them ignored it, so "Used" could show a page of sealed boxes
 * priced against a used chart. Everything in that column answers the same
 * question now.
 */
export async function getFigureBySlug(slug: string, condition?: ItemCondition) {
  return prisma.figure.findUnique({
    where: { slug },
    include: {
      manufacturer: true,
      series: { include: { franchise: { select: { name: true, slug: true } } } },
      characters: { include: { series: { select: { name: true, slug: true } } } },
      images: { orderBy: { sortOrder: "asc" } },
      // The archive id, which links back to the manufacturer's entry for the
      // product, and the release number, which is what makes their store
      // search land on the right thing.
      identifiers: {
        where: { kind: { in: ["GSC_PRODUCT", "NENDOROID_NO", "FIGMA_NO"] } },
        select: { kind: true, value: true },
      },
      listings: {
        // UNKNOWN is left out rather than shown under both tabs. A price whose
        // condition nobody established is not evidence about either one, and
        // 1,700 of them across the catalogue is not worth muddying the column
        // that a buyer reads to decide.
        where: { isActive: true, ...(condition ? { condition } : {}) },
        orderBy: { amountUsd: "asc" },
        take: 12,
        include: { source: { select: { key: true, name: true } } },
      },
      sales: {
        orderBy: { soldAt: "desc" },
        take: 20,
        include: { source: { select: { key: true, name: true } } },
      },
    },
  });
}

export type PricePoint = {
  date: string;
  median: number | null;
  min: number | null;
  max: number | null;
  /** Listings behind an asking point, or sales behind a sold one. */
  volume: number;
  /** What this point is. The chart says so rather than leaving it implied. */
  basis: ValueBasis;
};

/**
 * Daily price series for the chart. Reads only PriceSnapshot, so cost is
 * independent of how many raw sales sit behind it.
 */
export async function getPriceHistory(
  figureId: string,
  condition: ItemCondition,
  days: number,
): Promise<PricePoint[]> {
  const since = new Date(Date.now() - days * 86400_000);
  const rows = await prisma.priceSnapshot.findMany({
    where: { figureId, condition, date: { gte: since } },
    orderBy: { date: "asc" },
    select: {
      date: true,
      medianUsd: true,
      minUsd: true,
      maxUsd: true,
      sampleSize: true,
      askMedianUsd: true,
      askMinUsd: true,
      askMaxUsd: true,
      askCount: true,
    },
  });

  // A sold price where the day has one, the asking spread otherwise — the same
  // decision figureValue makes for the headline number, so the chart and the
  // figure above it never rest on different things without saying so.
  //
  // A day with neither is dropped rather than plotted as a gap: the series is
  // "what we could see", and a missing day is not a price of zero.
  return rows.flatMap((r): PricePoint[] => {
    const day = dayValue(r);
    if (!day) return [];
    return [{ date: r.date.toISOString().slice(0, 10), ...day }];
  });
}

/** Summary stats shown above the chart. */
export async function getFigureStats(figureId: string, condition: ItemCondition) {
  const [allTime, recent, lowestAsk] = await Promise.all([
    prisma.priceSnapshot.aggregate({
      where: { figureId, condition },
      _min: { minUsd: true },
      _max: { maxUsd: true },
      _sum: { sampleSize: true },
    }),
    prisma.priceSnapshot.findFirst({
      where: { figureId, condition },
      orderBy: { date: "desc" },
      select: { medianUsd: true, date: true, sampleSize: true },
    }),
    prisma.listing.findFirst({
      where: { figureId, isActive: true, condition },
      orderBy: { amountUsd: "asc" },
      select: { amountUsd: true, url: true, source: { select: { name: true } } },
    }),
  ]);

  return {
    allTimeLow: allTime._min.minUsd ? Number(allTime._min.minUsd) : null,
    allTimeHigh: allTime._max.maxUsd ? Number(allTime._max.maxUsd) : null,
    totalSales: allTime._sum.sampleSize ?? 0,
    lastMedian: recent ? Number(recent.medianUsd) : null,
    lastDate: recent?.date ?? null,
    lowestAsk: lowestAsk
      ? { amountUsd: Number(lowestAsk.amountUsd), url: lowestAsk.url, source: lowestAsk.source.name }
      : null,
  };
}

export async function getTopMovers(direction: "up" | "down", take = 6) {
  "use cache";
  catalogueCacheLife();

  return prisma.figure.findMany({
    where: {
      supersededById: null,
      change30dPct: direction === "up" ? { gt: 0 } : { lt: 0 },
      salesVolume90d: { gte: 3 },
    },
    select: figureCardSelect,
    orderBy: { change30dPct: direction === "up" ? "desc" : "asc" },
    take,
  });
}

export async function getMostTracked(take = 8) {
  "use cache";
  catalogueCacheLife();

  return prisma.figure.findMany({
    where: { supersededById: null },
    select: figureCardSelect,
    orderBy: { salesVolume90d: "desc" },
    take,
  });
}

export async function getFacets() {
  "use cache";
  catalogueCacheLife();

  // A head of each list, ordered by how many figures it holds, so the first
  // screen is the part of the catalogue worth browsing. The rest is reached by
  // typing, which asks the database — see lib/filter-options.ts for why the
  // whole list is not sent.
  const [franchises, characters, manufacturers, categoryCounts] = await Promise.all([
    filterOptions("franchise"),
    filterOptions("character"),
    filterOptions("manufacturer"),
    prisma.figure.groupBy({ by: ["category"], _count: { _all: true } }),
  ]);

  return {
    franchises,
    characters,
    manufacturers,
    categories: categoryCounts
      .map((c) => ({ category: c.category, count: c._count._all }))
      .sort((a, b) => b.count - a.count),
  };
}

export async function getCatalogTotals() {
  "use cache";
  catalogueCacheLife();

  const [figures, sales, sources] = await Promise.all([
    prisma.figure.count({ where: { supersededById: null } }),
    prisma.sale.count(),
    prisma.source.count({ where: { enabled: true } }),
  ]);
  return { figures, sales, sources };
}

/**
 * The cache tag for one figure's page.
 *
 * Anything that changes a figure — an import, a moderator edit, an image
 * change — should revalidate this tag so the cached render is rebuilt rather
 * than waiting out its hour.
 */
export function figureCacheTag(slug: string): string {
  return `figure:${slug}`;
}

/**
 * Just the id, for the parts of a figure page that render per visitor.
 *
 * Those run outside the cached render and therefore cannot reuse the figure it
 * already loaded. This is a single indexed lookup returning one column, which
 * is much cheaper than either loading the figure twice or giving up caching.
 */
export async function getFigureIdBySlug(slug: string): Promise<{ id: string } | null> {
  return prisma.figure.findUnique({ where: { slug }, select: { id: true } });
}

/** The images, for the moderator-only editor. Read only once a moderator is known. */
export async function getFigureImagesBySlug(slug: string) {
  return prisma.figure.findUnique({
    where: { slug },
    select: {
      id: true,
      primaryImageUrl: true,
      images: {
        select: { id: true, url: true, credit: true, sourceUrl: true, licenseNote: true },
      },
    },
  });
}

/**
 * Where a folded reissue's page should send the reader.
 *
 * Both entries describe real releases, so neither URL is deleted — but only one
 * of them carries the listings, and that is the page worth showing. Returns
 * null for a figure that stands on its own, which is nearly all of them.
 */
export async function supersededTarget(slug: string): Promise<string | null> {
  const row = await prisma.figure.findUnique({
    where: { slug },
    select: { supersededBy: { select: { slug: true } } },
  });
  return row?.supersededBy?.slug ?? null;
}
