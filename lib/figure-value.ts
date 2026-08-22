import { toNumber } from "./money";

/**
 * The one number this site can honestly put on a figure, and where it came
 * from.
 *
 * There are no sold prices in this catalogue and, as of August 2026, no route
 * to any: eBay's Marketplace Insights is reserved for approved partners with no
 * published criteria, Yahoo! Auctions disallows its closed-search archive in
 * robots.txt, and Mercari serves its results only from the two paths its
 * robots.txt disallows. See docs/DATA_SOURCES.md.
 *
 * So the site is built around asking prices — what sellers currently want —
 * with the basis carried alongside every number rather than assumed. A median
 * of what people are asking is a weaker claim than a record of what something
 * sold for, and the difference has to survive all the way to the label. The
 * alternative, while there is no sold-price source at all, is a dash on every
 * figure in the catalogue and a collection page that values everything at zero.
 *
 * When sold prices do arrive, `sold` starts winning here and every screen that
 * uses this follows without being touched.
 */

export type ValueBasis = "sold" | "asking";

export type FigureValue = {
  amountUsd: number;
  basis: ValueBasis;
  /** How many listings the asking median came from. Zero for a sold price. */
  listings: number;
};

type Valuable = {
  marketValueUsd: unknown;
  askMedianUsd?: unknown;
  askListings?: number | null;
};

/**
 * The best-supported value for one figure, or null when there is neither.
 *
 * A sold price always wins. It is a record of a completed transaction and an
 * asking price is a hope.
 */
export function figureValue(figure: Valuable): FigureValue | null {
  const sold = toNumber(figure.marketValueUsd as never);
  if (sold !== null) return { amountUsd: sold, basis: "sold", listings: 0 };

  const asking = toNumber(figure.askMedianUsd as never);
  if (asking !== null) {
    return { amountUsd: asking, basis: "asking", listings: figure.askListings ?? 0 };
  }
  return null;
}

/** "Market value" or "Typical asking price" — the label that fits the basis. */
export function valueLabel(basis: ValueBasis, short = false): string {
  if (basis === "sold") return short ? "Market value" : "Market value";
  return short ? "Asking price" : "Typical asking price";
}

/** "median of 14 listings", for showing what an asking price rests on. */
export function valueNote(value: FigureValue): string | null {
  if (value.basis === "sold") return null;
  return `median of ${value.listings} listing${value.listings === 1 ? "" : "s"}`;
}

export type PortfolioValue = {
  totalUsd: number;
  /** How many items contributed, and on what basis. */
  fromSold: number;
  fromAsking: number;
  /** Items with no value available at all, so the total understates. */
  unvalued: number;
};

/**
 * Add up a collection.
 *
 * Reports what the total is made of rather than only its size. A total summed
 * mostly from asking prices should not be presented as though it were a
 * valuation, and a page cannot say so unless this tells it.
 */
export function sumValues(
  rows: { quantity: number; figure: Valuable }[],
): PortfolioValue {
  let totalUsd = 0;
  let fromSold = 0;
  let fromAsking = 0;
  let unvalued = 0;

  for (const row of rows) {
    const value = figureValue(row.figure);
    if (!value) {
      unvalued += row.quantity;
      continue;
    }
    totalUsd += value.amountUsd * row.quantity;
    if (value.basis === "sold") fromSold += row.quantity;
    else fromAsking += row.quantity;
  }

  return { totalUsd: Math.round(totalUsd * 100) / 100, fromSold, fromAsking, unvalued };
}

/**
 * How to describe a total, given what went into it.
 *
 * Deliberately not a percentage or a confidence score. The reader needs to know
 * whether the number rests on completed sales or on what sellers are asking,
 * and any figure precise enough to look computed would imply a rigour that a
 * median of listings does not have.
 */
export function portfolioBasis(value: PortfolioValue): ValueBasis | null {
  if (value.fromSold === 0 && value.fromAsking === 0) return null;
  return value.fromAsking > value.fromSold ? "asking" : "sold";
}

/** One day of PriceSnapshot, as much of it as the decision needs. */
export type SnapshotRow = {
  medianUsd: unknown;
  minUsd: unknown;
  maxUsd: unknown;
  sampleSize: number | null;
  askMedianUsd: unknown;
  askMinUsd: unknown;
  askMaxUsd: unknown;
  askCount: number | null;
};

export type DayValue = {
  median: number;
  min: number | null;
  max: number | null;
  volume: number;
  basis: ValueBasis;
};

/**
 * What a single day of history can honestly report.
 *
 * The same rule as `figureValue`, applied to a day instead of to a figure: a
 * sold price where the day has one, the asking spread otherwise. Kept beside it
 * deliberately — if the chart and the headline number ever chose differently,
 * the page would state two things at once and look wrong in a way that is very
 * hard to spot.
 *
 * Returns null for a day with neither, so the caller drops it. A day we could
 * not see is not a price of zero, and plotting it as one would draw a cliff.
 */
export function dayValue(row: SnapshotRow): DayValue | null {
  const sold = toNumber(row.medianUsd as never);
  if (sold !== null) {
    return {
      median: sold,
      min: toNumber(row.minUsd as never),
      max: toNumber(row.maxUsd as never),
      volume: row.sampleSize ?? 0,
      basis: "sold",
    };
  }

  const asking = toNumber(row.askMedianUsd as never);
  if (asking !== null) {
    return {
      median: asking,
      min: toNumber(row.askMinUsd as never),
      max: toNumber(row.askMaxUsd as never),
      volume: row.askCount ?? 0,
      basis: "asking",
    };
  }

  return null;
}
