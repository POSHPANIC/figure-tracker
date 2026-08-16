/**
 * Deciding which figures are worth spending marketplace quota on.
 *
 * eBay's free tier allows a few thousand Browse calls a day and the catalogue
 * holds over seven thousand figures, so polling everything in rotation means a
 * full sweep takes days and every figure's prices are equally out of date.
 * Ranking fixes that: a figure somebody owns, wants, or is reading about gets
 * looked at daily, and the long tail still comes round eventually.
 *
 * Pure, so the ranking can be tested without a database or an API — it decides
 * where a scarce budget goes, and "seems about right" is not good enough for
 * that.
 */

export type PollCandidate = {
  id: string;
  /** People who own it. The strongest signal: they watch its value. */
  collectionCount: number;
  /** People waiting to buy it. Nearly as strong — they want a price now. */
  wishlistCount: number;
  /** Page opens, crawlers excluded. Weak and noisy, but real. */
  viewCount: number;
  releaseDate: Date | null;
  /** Null means never polled. */
  lastPolledAt: Date | null;
};

/**
 * How much anyone appears to care about this figure.
 *
 * Owning outranks wishing, which outranks reading. Views are capped because a
 * figure that gets linked somewhere popular shouldn't monopolise the budget on
 * the strength of one busy afternoon — past a point, more views say nothing new.
 */
export function demandScore(figure: PollCandidate, now: Date = new Date()): number {
  let score = figure.collectionCount * 10 + figure.wishlistCount * 6;
  score += Math.min(figure.viewCount, 100) * 0.5;

  // A figure released in the last six months is actively trading, whether or
  // not anyone here has noticed it yet. This is the only forward-looking term:
  // everything else needs a user to have done something first, which a figure
  // released yesterday has had no chance to accumulate.
  if (figure.releaseDate) {
    const days = (now.getTime() - figure.releaseDate.getTime()) / 86_400_000;
    if (days >= -120 && days <= 180) score += 8;
  }

  return score;
}

/** Days since the last poll. Never-polled sorts as very stale, not as zero. */
export function stalenessDays(figure: PollCandidate, now: Date = new Date()): number {
  if (!figure.lastPolledAt) return NEVER_POLLED_DAYS;
  const days = (now.getTime() - figure.lastPolledAt.getTime()) / 86_400_000;
  return Math.max(0, days);
}

/** A figure nobody has ever polled is treated as this stale. */
const NEVER_POLLED_DAYS = 60;

/** Beyond this, waiting longer stops adding urgency. */
const STALENESS_CEILING_DAYS = 30;

/**
 * What to poll next, highest first.
 *
 * Demand alone would poll the same popular figures every run and never reach
 * anything else, so it is multiplied by how long the figure has been waiting.
 * A figure checked this morning scores near zero however popular it is; one
 * untouched for a month is worth thirty times its demand.
 *
 * The `+ 1` on demand is what keeps the tail moving: a figure nobody has ever
 * looked at still accrues priority with time, just slowly. Without it, anything
 * with no owners, no wishlists and no views would multiply out to zero and
 * never be polled at all — which is how a catalogue quietly develops a dead
 * half.
 */
export function pollPriority(figure: PollCandidate, now: Date = new Date()): number {
  const demand = demandScore(figure, now);
  const waited = Math.min(stalenessDays(figure, now), STALENESS_CEILING_DAYS);
  return (demand + 1) * waited;
}

/** Rank candidates and take the top `limit`. */
export function selectByPriority<T extends PollCandidate>(
  figures: T[],
  limit: number,
  now: Date = new Date(),
): T[] {
  return [...figures]
    .map((f) => ({ f, score: pollPriority(f, now) }))
    // A figure polled minutes ago scores ~0; skip rather than waste a call.
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ f }) => f);
}
