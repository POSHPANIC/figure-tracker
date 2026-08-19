import { prisma } from "../prisma";
import { pruneRateLimits } from "../rate-limit-store";
import { rebuildAllSearchText } from "./search-index";
import type { ItemCondition } from "../generated/prisma/enums";

/**
 * Nightly aggregation.
 *
 * Raw Sale rows are the source of truth but are too expensive to chart
 * directly, so this rolls them up into one PriceSnapshot per figure/condition/
 * day, then recomputes the denormalized columns on Figure that list and search
 * pages read.
 *
 * Idempotent: re-running for the same day overwrites that day's snapshots
 * rather than double-counting.
 */

export const CHARTED_CONDITIONS: ItemCondition[] = ["NEW_SEALED", "USED_COMPLETE"];

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export type AggregateResult = {
  snapshotsWritten: number;
  figuresUpdated: number;
};

/**
 * Build snapshots for the given day (default: yesterday, since today is still
 * accumulating sales) and refresh every figure's summary stats.
 */
export async function runAggregation(forDay?: Date): Promise<AggregateResult> {
  const day = startOfUtcDay(forDay ?? new Date(Date.now() - 86400_000));
  const dayEnd = new Date(day.getTime() + 86400_000);

  const sales = await prisma.sale.findMany({
    where: { soldAt: { gte: day, lt: dayEnd } },
    select: { figureId: true, condition: true, amountUsd: true },
  });

  // Group in memory: one day of sales is small, and this keeps the SQL simple.
  const buckets = new Map<string, number[]>();
  for (const s of sales) {
    if (!CHARTED_CONDITIONS.includes(s.condition)) continue;
    const key = `${s.figureId}|${s.condition}`;
    const list = buckets.get(key);
    if (list) list.push(Number(s.amountUsd));
    else buckets.set(key, [Number(s.amountUsd)]);
  }

  // Lowest active ask per figure/condition, for the "buy it now" reference.
  const asks = await prisma.listing.groupBy({
    by: ["figureId", "condition"],
    where: { isActive: true, figureId: { not: null } },
    _min: { amountUsd: true },
  });
  const askByKey = new Map(
    asks
      .filter((a) => a.figureId)
      .map((a) => [`${a.figureId}|${a.condition}`, a._min.amountUsd ? Number(a._min.amountUsd) : null]),
  );

  let snapshotsWritten = 0;
  for (const [key, prices] of buckets) {
    const [figureId, condition] = key.split("|") as [string, ItemCondition];

    await prisma.priceSnapshot.upsert({
      where: { figureId_condition_date: { figureId, condition, date: day } },
      create: {
        figureId,
        condition,
        date: day,
        minUsd: round2(Math.min(...prices)),
        medianUsd: round2(median(prices)),
        avgUsd: round2(prices.reduce((a, b) => a + b, 0) / prices.length),
        maxUsd: round2(Math.max(...prices)),
        sampleSize: prices.length,
        lowestAskUsd: askByKey.get(key) ?? null,
      },
      update: {
        minUsd: round2(Math.min(...prices)),
        medianUsd: round2(median(prices)),
        avgUsd: round2(prices.reduce((a, b) => a + b, 0) / prices.length),
        maxUsd: round2(Math.max(...prices)),
        sampleSize: prices.length,
        lowestAskUsd: askByKey.get(key) ?? null,
      },
    });
    snapshotsWritten += 1;
  }

  const figuresUpdated = await recomputeFigureStats();

  // Rate-limit counters are disposable once their window has closed, and
  // nothing else deletes them.
  const prunedCounters = await pruneRateLimits();
  if (prunedCounters > 0) {
    console.info(`[aggregate] pruned ${prunedCounters} expired rate-limit counters`);
  }

  // Asking prices, from whatever is listed right now. Cheap, and the only
  // price most figures have while there is no sold-price source.
  const asksUpdated = await recomputeAskingPrices();
  if (asksUpdated > 0) console.info(`[aggregate] refreshed asking prices for ${asksUpdated} figures`);

  // Keep search in step with any catalogue metadata that changed today.
  const reindexed = await rebuildAllSearchText();
  if (reindexed > 0) console.info(`[aggregate] refreshed search text for ${reindexed} figures`);

  return { snapshotsWritten, figuresUpdated };
}

/**
 * How confident the matcher has to be before a listing counts toward the asking
 * price.
 *
 * Deliberately stricter than MATCH_ACCEPT_THRESHOLD, which is 0.72. A listing
 * shown in a list is one a reader can judge for themselves; a listing folded
 * into a published number is one nobody can see. Showing more than we average
 * over is the right way round.
 *
 * A third of attached listings score below this — 23,235 of 67,135 — and a
 * median inherits whatever is in its sample. Applying the threshold pulls the
 * median spread between a figure's cheapest and dearest listing from 2.46x down
 * to 2.02x, and cuts the figures showing a tenfold spread from 239 to 82.
 */
const ASK_MIN_MATCH_SCORE = 0.8;

/**
 * How many listings before a median means anything.
 *
 * With one listing a "median" is one seller's opinion. Three is where several
 * strangers independently pricing the same product starts to say something,
 * and it still leaves 2,437 figures with a number where today there are none.
 */
const ASK_MIN_LISTINGS = 3;

/**
 * Refresh Figure.askMedianUsd / askListings from active listings.
 *
 * One statement for the whole catalogue rather than one per figure. The sibling
 * recomputeFigureStats already walks 7,068 figures a row at a time, and adding
 * a second query per figure to that would double a cost that is already the
 * wrong shape — this is a single round trip.
 *
 * Median rather than mean, for the same reason market value uses one: a lone
 * $2,000 listing on a $60 figure should not move the number. And only
 * NEW_SEALED, so a boxed figure is not priced against a loose one.
 */
export async function recomputeAskingPrices(): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "Figure" f
    SET "askMedianUsd" = s.med,
        "askListings"  = s.n
    FROM (
      SELECT all_figures.id AS fid,
             stats.med,
             coalesce(stats.n, 0) AS n
      FROM "Figure" all_figures
      LEFT JOIN (
        SELECT "figureId",
               round(percentile_cont(0.5) WITHIN GROUP (ORDER BY "amountUsd")::numeric, 2) AS med,
               count(*)::int AS n
        FROM "Listing"
        WHERE "figureId" IS NOT NULL
          AND "isActive"
          AND condition = 'NEW_SEALED'
          AND "matchScore" >= ${ASK_MIN_MATCH_SCORE}
        GROUP BY "figureId"
        HAVING count(*) >= ${ASK_MIN_LISTINGS}
      ) stats ON stats."figureId" = all_figures.id
    ) s
    WHERE f.id = s.fid
      -- Only rows that actually changed. A figure whose listings did not move
      -- should not be rewritten every night.
      AND (f."askMedianUsd" IS DISTINCT FROM s.med OR f."askListings" IS DISTINCT FROM s.n)
  `;
}

/**
 * Refresh Figure.marketValueUsd / change30dPct / salesVolume90d.
 *
 * Market value is the *median* of the last 30 days of NEW_SEALED sales, not the
 * mean — one absurd $2,000 "buy it now" sale shouldn't move a $200 figure. When
 * the last 30 days are empty we widen to 90 so a slow-moving figure still shows
 * a value rather than a dash.
 */
export async function recomputeFigureStats(): Promise<number> {
  const figures = await prisma.figure.findMany({ select: { id: true } });
  let updated = 0;
  for (const { id } of figures) {
    if (await recomputeFigureStatsFor(id)) updated += 1;
  }
  return updated;
}

/**
 * Refresh one figure. Called after a moderator approves or rejects a reported
 * sale, so the published value reflects the decision immediately instead of
 * waiting for the nightly job.
 *
 * Returns false when the figure has no recent sales to compute from.
 */
export async function recomputeFigureStatsFor(figureId: string): Promise<boolean> {
  const now = Date.now();
  const d30 = new Date(now - 30 * 86400_000);
  const d60 = new Date(now - 60 * 86400_000);
  const d90 = new Date(now - 90 * 86400_000);

  const recent = await prisma.sale.findMany({
    where: {
      figureId,
      condition: "NEW_SEALED",
      soldAt: { gte: d90 },
    },
    select: { amountUsd: true, soldAt: true },
  });

  if (recent.length === 0) {
    // Clear the price rather than leaving the last known one sitting there.
    //
    // "What did this sell for at some unstated point in the past" is not what a
    // market value claims to be, and a figure that stops trading would
    // otherwise keep quoting a number forever with nothing marking it stale.
    // No recent sales means we don't know — say so, and let the chart show the
    // history that does exist.
    await prisma.figure.update({
      where: { id: figureId },
      data: {
        marketValueUsd: null,
        change30dPct: null,
        salesVolume90d: 0,
        lastAggregatedAt: new Date(),
      },
    });
    return false;
  }

  const asNumber = (v: { toString(): string }) => Number(v.toString());
  const current = recent.filter((s) => s.soldAt >= d30).map((s) => asNumber(s.amountUsd));
  const prior = recent
    .filter((s) => s.soldAt >= d60 && s.soldAt < d30)
    .map((s) => asNumber(s.amountUsd));

  const marketValue = current.length
    ? median(current)
    : median(recent.map((s) => asNumber(s.amountUsd)));

  // Only report a change when both windows have data to compare.
  const change =
    current.length && prior.length
      ? ((median(current) - median(prior)) / median(prior)) * 100
      : null;

  await prisma.figure.update({
    where: { id: figureId },
    data: {
      marketValueUsd: round2(marketValue),
      change30dPct: change === null ? null : round2(change),
      salesVolume90d: recent.length,
      lastAggregatedAt: new Date(),
    },
  });

  return true;
}

/**
 * Mark listings we haven't seen in a while as inactive. Sources rarely tell us
 * when something sells or is delisted, so absence is the signal.
 */
/**
 * Delete individual sale records once they age out of the source window.
 *
 * eBay's Marketplace Insights returns the last 90 days of completed sales, and
 * our application to them states that we keep individual records only for that
 * window. This is what makes the statement true rather than aspirational — a
 * retention promise nothing enforces is a compliance problem waiting for the
 * day somebody checks.
 *
 * The daily summaries in PriceSnapshot are untouched and are what long-term
 * price history is built from: min, median, average, maximum and sample size
 * per figure, per condition, per day. That split is deliberate. Aggregates say
 * what a figure was worth without retaining anybody's individual transaction.
 *
 * Must run *after* aggregation, never before — summarising yesterday and then
 * deleting the day it summarised is the right order, and the reverse quietly
 * loses data.
 */
export async function purgeExpiredSales(olderThanDays = 90): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86400_000);
  const result = await prisma.sale.deleteMany({ where: { soldAt: { lt: cutoff } } });
  return result.count;
}

export async function expireStaleListings(olderThanDays = 3): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86400_000);
  const result = await prisma.listing.updateMany({
    where: { isActive: true, lastSeen: { lt: cutoff } },
    data: { isActive: false },
  });
  return result.count;
}
