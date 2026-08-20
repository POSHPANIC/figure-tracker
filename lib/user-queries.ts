import "server-only";
import { prisma } from "./prisma";
import { toNumber } from "./money";
import { figureCardSelect } from "./queries";

/**
 * Reads for signed-in user data: collections, wishlists, public profiles.
 * Kept separate from queries.ts so it's obvious which reads are personal.
 */

const collectionItemSelect = {
  id: true,
  quantity: true,
  condition: true,
  paidAmount: true,
  paidCurrency: true,
  paidAmountUsd: true,
  purchasedAt: true,
  notes: true,
  createdAt: true,
  figure: { select: figureCardSelect },
} as const;

export type PortfolioTotals = {
  itemCount: number;
  uniqueFigures: number;
  /** Sum of market value × quantity. Null-valued figures count as 0. */
  marketValueUsd: number;
  /** Sum of what was paid, for items where a price was recorded. */
  paidUsd: number;
  /** Only counts items that have BOTH a paid price and a market value. */
  gainUsd: number;
  gainPct: number | null;
  /** Items with no recorded purchase price — excluded from gain math. */
  itemsWithoutCost: number;
};

export async function getCollection(userId: string) {
  const items = await prisma.collectionItem.findMany({
    where: { userId },
    select: collectionItemSelect,
    orderBy: { createdAt: "desc" },
  });

  return { items, totals: computeTotals(items) };
}

type CollectionRow = {
  quantity: number;
  paidAmountUsd: unknown;
  figure: { marketValueUsd: unknown };
};

/**
 * Portfolio maths.
 *
 * Gain is computed only across items that have both a cost and a market value —
 * otherwise an item with no recorded purchase price would look like 100% profit
 * and quietly inflate the headline number.
 */
export function computeTotals(items: CollectionRow[]): PortfolioTotals {
  let marketValueUsd = 0;
  let paidUsd = 0;
  let comparablePaid = 0;
  let comparableValue = 0;
  let itemsWithoutCost = 0;
  let itemCount = 0;

  for (const item of items) {
    const qty = item.quantity;
    const value = toNumber(item.figure.marketValueUsd as never);
    const paid = toNumber(item.paidAmountUsd as never);

    itemCount += qty;
    if (value !== null) marketValueUsd += value * qty;
    if (paid !== null) paidUsd += paid * qty;
    else itemsWithoutCost += qty;

    if (paid !== null && value !== null) {
      comparablePaid += paid * qty;
      comparableValue += value * qty;
    }
  }

  const gainUsd = comparableValue - comparablePaid;

  return {
    itemCount,
    uniqueFigures: items.length,
    marketValueUsd: round2(marketValueUsd),
    paidUsd: round2(paidUsd),
    gainUsd: round2(gainUsd),
    gainPct: comparablePaid > 0 ? round2((gainUsd / comparablePaid) * 100) : null,
    itemsWithoutCost,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function getWishlist(userId: string) {
  return prisma.wishlistItem.findMany({
    where: { userId },
    select: {
      id: true,
      priority: true,
      createdAt: true,
      figure: { select: figureCardSelect },
    },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
  });
}

/** What the signed-in user already has for one figure, for the detail page. */
export async function getFigureUserState(userId: string, figureId: string) {
  const [collectionItems, wishlistItem] = await Promise.all([
    prisma.collectionItem.findMany({
      where: { userId, figureId },
      select: {
        id: true,
        quantity: true,
        condition: true,
        paidAmount: true,
        paidCurrency: true,
        purchasedAt: true,
      },
    }),
    prisma.wishlistItem.findUnique({
      where: { userId_figureId: { userId, figureId } },
      select: { id: true, priority: true },
    }),
  ]);

  return { collectionItems, wishlistItem };
}

/**
 * The submissions inbox: open items, oldest first so nothing sits forever.
 *
 * Counts are returned per kind as well as in total, because a queue of forty
 * missing-figure requests and a queue of forty bug reports call for different
 * afternoons.
 */
export async function getSubmissionQueue(take = 50) {
  const [items, openByKind] = await Promise.all([
    prisma.submission.findMany({
      where: { status: "OPEN" },
      select: {
        id: true,
        kind: true,
        details: true,
        pageUrl: true,
        figureName: true,
        manufacturer: true,
        series: true,
        referenceUrl: true,
        imageUrl: true,
        proposedFields: true,
        saleAmount: true,
        saleCurrency: true,
        saleDate: true,
        saleCondition: true,
        saleUrl: true,
        saleFlag: true,
        figure: {
          select: {
            id: true,
            slug: true,
            name: true,
            fieldLocks: { select: { field: true } },
          },
        },
        contactEmail: true,
        createdAt: true,
        user: { select: { id: true, username: true, name: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
      take,
    }),
    prisma.submission.groupBy({
      by: ["kind"],
      where: { status: "OPEN" },
      _count: { _all: true },
    }),
  ]);

  const counts = Object.fromEntries(openByKind.map((c) => [c.kind, c._count._all]));
  return {
    items,
    openCount: openByKind.reduce((sum, c) => sum + c._count._all, 0),
    counts: {
      FEEDBACK: counts.FEEDBACK ?? 0,
      BUG: counts.BUG ?? 0,
      FIGURE: counts.FIGURE ?? 0,
      EDIT: counts.EDIT ?? 0,
      SALE: counts.SALE ?? 0,
    },
  };
}

/** Public profile by username. Returns null when missing or set to private. */
export async function getPublicProfile(username: string) {
  const user = await prisma.user.findUnique({
    where: { username },
    select: {
      id: true,
      name: true,
      username: true,
      image: true,
      bio: true,
      publicProfile: true,
      createdAt: true,
    },
  });

  if (!user || !user.publicProfile) return null;

  const items = await prisma.collectionItem.findMany({
    where: { userId: user.id },
    select: collectionItemSelect,
    orderBy: { createdAt: "desc" },
  });

  const totals = computeTotals(items);

  return {
    user,
    items,
    // Deliberately omit cost and gain — what someone paid is nobody's business
    // but theirs, even on a profile they've chosen to make public.
    publicTotals: {
      itemCount: totals.itemCount,
      uniqueFigures: totals.uniqueFigures,
      marketValueUsd: totals.marketValueUsd,
    },
  };
}

/**
 * Products the catalogue looks to be missing, worst gap first.
 *
 * Ordered by how many listings named the number, because that is the closest
 * thing to a measure of how much the absence costs: a product twenty sellers
 * are listing is one people are looking for.
 */
export async function getFigureCandidates(take = 40) {
  const [items, openCount] = await Promise.all([
    prisma.figureCandidate.findMany({
      where: { status: "OPEN" },
      select: {
        id: true,
        line: true,
        number: true,
        source: true,
        sourceUrl: true,
        vendor: true,
        listingCount: true,
        sampleTitles: true,
        firstSeenAt: true,
      },
      // Numbered candidates first: accepting one records a release number,
      // which is a fact, where accepting a retailer's product is a judgement.
      // Within each, the best-corroborated and then the longest-waiting.
      orderBy: [{ number: { sort: "desc", nulls: "last" } }, { listingCount: "desc" }, { firstSeenAt: "asc" }],
      take,
    }),
    prisma.figureCandidate.count({ where: { status: "OPEN" } }),
  ]);
  return { items, openCount };
}
