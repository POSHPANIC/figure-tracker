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

export type ValueBasis = "sold" | "asking" | "msrp";

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
  /** The maker's price in dollars, for a figure nobody can have bought yet. */
  msrpUsd?: unknown;
  /**
   * A Date from Prisma, or the string it becomes on the way out of a cache.
   *
   * getFigureBySlug sits behind "use cache", which serialises what it returns,
   * so by the time the page reads this it is an ISO string. An earlier version
   * tested `instanceof Date` and was therefore false on every cached page --
   * correct in a script, silently inert in the product.
   */
  releaseDate?: Date | string | null;
};

/**
 * Whether the figure has not come out yet.
 *
 * Read off the release date rather than `status`, which importers set once from
 * the date they saw and never revisit -- 42 figures are still marked PREORDER
 * with a release date in the past. A date compared against today cannot go
 * stale that way.
 */
function unreleased(figure: Valuable, now = new Date()): boolean {
  const raw = figure.releaseDate;
  if (!raw) return false;
  const at = raw instanceof Date ? raw.getTime() : Date.parse(raw);
  return Number.isFinite(at) && at > now.getTime();
}

/**
 * The best-supported value for one figure, or null when there is neither.
 *
 * A sold price always wins. It is a record of a completed transaction and an
 * asking price is a hope.
 */
export function figureValue(figure: Valuable, now = new Date()): FigureValue | null {
  const sold = toNumber(figure.marketValueUsd as never);
  if (sold !== null) return { amountUsd: sold, basis: "sold", listings: 0 };

  // Before release, the maker's price beats what sellers are asking.
  //
  // Nothing has changed hands yet, so an asking price here is not a weak
  // reading of a market -- there is no market to read. It is somebody quoting a
  // number for a thing they do not have, and on a preorder those run well above
  // the price the shop will take today. The list price is the one figure that
  // is actually true before release, and it is what the reader can pay.
  //
  // Only ahead of asking, never ahead of a completed sale.
  if (unreleased(figure, now)) {
    const msrp = toNumber(figure.msrpUsd as never);
    if (msrp !== null) return { amountUsd: msrp, basis: "msrp", listings: 0 };
  }

  const asking = toNumber(figure.askMedianUsd as never);
  if (asking !== null) {
    return { amountUsd: asking, basis: "asking", listings: figure.askListings ?? 0 };
  }
  return null;
}

/** "Market value" or "Typical asking price" — the label that fits the basis. */
export function valueLabel(basis: ValueBasis, short = false): string {
  if (basis === "sold") return short ? "Market value" : "Market value";
  // Named for what it is. Calling a list price a "market value" would be the
  // exact confusion this module exists to prevent, and it is not an asking
  // price either -- nobody is asking it, the maker set it.
  if (basis === "msrp") return short ? "Retail price" : "Retail price";
  return short ? "Asking price" : "Typical asking price";
}

/** "median of 14 listings", for showing what an asking price rests on. */
export function valueNote(value: FigureValue): string | null {
  if (value.basis === "sold") return null;
  if (value.basis === "msrp") return "the maker's price — not yet released";
  return `median of ${value.listings} listing${value.listings === 1 ? "" : "s"}`;
}

export type PortfolioValue = {
  totalUsd: number;
  /** How many items contributed, and on what basis. */
  fromSold: number;
  fromAsking: number;
  /** Unreleased items counted at the maker's price. */
  fromMsrp: number;
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
  let fromMsrp = 0;
  let unvalued = 0;

  for (const row of rows) {
    const value = figureValue(row.figure);
    if (!value) {
      unvalued += row.quantity;
      continue;
    }
    totalUsd += value.amountUsd * row.quantity;
    // Counted apart rather than folded into asking. A preorder valued at the
    // maker's price is a different kind of number again, and a total that
    // cannot say what it is made of is what this breakdown exists to prevent.
    if (value.basis === "sold") fromSold += row.quantity;
    else if (value.basis === "msrp") fromMsrp += row.quantity;
    else fromAsking += row.quantity;
  }

  return { totalUsd: Math.round(totalUsd * 100) / 100, fromSold, fromAsking, fromMsrp, unvalued };
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
  const counts: [ValueBasis, number][] = [
    ["sold", value.fromSold],
    ["asking", value.fromAsking],
    ["msrp", value.fromMsrp ?? 0],
  ];
  const best = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[1] === 0 ? null : best[0];
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
