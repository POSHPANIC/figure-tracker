import "server-only";
import { prisma } from "./prisma";
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
  manufacturer: { select: { name: true, slug: true } },
  series: { select: { name: true, slug: true } },
} satisfies Prisma.FigureSelect;

export type FigureCard = Prisma.FigureGetPayload<{ select: typeof figureCardSelect }>;

export type SortKey = "trending" | "value-desc" | "value-asc" | "newest" | "name";

const ORDER_BY: Record<SortKey, Prisma.FigureOrderByWithRelationInput[]> = {
  trending: [{ change30dPct: "desc" }, { salesVolume90d: "desc" }],
  "value-desc": [{ marketValueUsd: "desc" }],
  "value-asc": [{ marketValueUsd: "asc" }],
  newest: [{ releaseDate: "desc" }],
  name: [{ name: "asc" }],
};

export type FigureFilters = {
  q?: string;
  category?: FigureCategory;
  seriesSlug?: string;
  franchiseSlug?: string;
  manufacturerSlug?: string;
  minUsd?: number;
  maxUsd?: number;
  sort?: SortKey;
  page?: number;
  perPage?: number;
};

function buildWhere(f: FigureFilters): Prisma.FigureWhereInput {
  const where: Prisma.FigureWhereInput = {};

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
  if (f.minUsd !== undefined || f.maxUsd !== undefined) {
    where.marketValueUsd = {
      ...(f.minUsd !== undefined ? { gte: f.minUsd } : {}),
      ...(f.maxUsd !== undefined ? { lte: f.maxUsd } : {}),
    };
  }
  return where;
}

export async function searchFigures(filters: FigureFilters) {
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
      series: { select: { name: true } },
    },
    orderBy: [{ salesVolume90d: "desc" }],
    take: limit,
  });
}

export async function getFigureBySlug(slug: string) {
  return prisma.figure.findUnique({
    where: { slug },
    include: {
      manufacturer: true,
      series: { include: { franchise: { select: { name: true, slug: true } } } },
      characters: { include: { series: { select: { name: true, slug: true } } } },
      images: { orderBy: { sortOrder: "asc" } },
      listings: {
        where: { isActive: true },
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
  volume: number;
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
    select: { date: true, medianUsd: true, minUsd: true, maxUsd: true, sampleSize: true },
  });

  return rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    median: Number(r.medianUsd),
    min: Number(r.minUsd),
    max: Number(r.maxUsd),
    volume: r.sampleSize,
  }));
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
  return prisma.figure.findMany({
    where: {
      change30dPct: direction === "up" ? { gt: 0 } : { lt: 0 },
      salesVolume90d: { gte: 3 },
    },
    select: figureCardSelect,
    orderBy: { change30dPct: direction === "up" ? "desc" : "asc" },
    take,
  });
}

export async function getMostTracked(take = 8) {
  return prisma.figure.findMany({
    select: figureCardSelect,
    orderBy: { salesVolume90d: "desc" },
    take,
  });
}

/** A filter entry. Browsing is by franchise, so that is all these are. */
export type FranchiseFacet = {
  name: string;
  slug: string;
  count: number;
};

export async function getFacets() {
  const [franchises, manufacturers, categoryCounts] = await Promise.all([
    prisma.franchise.findMany({
      select: {
        name: true,
        slug: true,
        // Figures hang off series, so a franchise's total is the sum of its
        // series' rather than something Prisma can count directly.
        series: { select: { _count: { select: { figures: true } } } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.manufacturer.findMany({
      select: { name: true, slug: true, _count: { select: { figures: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.figure.groupBy({ by: ["category"], _count: { _all: true } }),
  ]);

  return {
    franchises: franchises
      .map((f) => ({
        name: f.name,
        slug: f.slug,
        count: f.series.reduce((n, s) => n + s._count.figures, 0),
      }))
      .filter((f) => f.count > 0),
    manufacturers: manufacturers.filter((m) => m._count.figures > 0),
    categories: categoryCounts
      .map((c) => ({ category: c.category, count: c._count._all }))
      .sort((a, b) => b.count - a.count),
  };
}

export async function getCatalogTotals() {
  const [figures, sales, sources] = await Promise.all([
    prisma.figure.count(),
    prisma.sale.count(),
    prisma.source.count({ where: { enabled: true } }),
  ]);
  return { figures, sales, sources };
}
