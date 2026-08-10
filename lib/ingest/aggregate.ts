import { prisma } from "../prisma";
import { pruneRateLimits } from "../rate-limit-store";
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
    // Only approved sales count. Anything a user reported that's still waiting
    // on a moderator must not move a published price in the meantime.
    where: { soldAt: { gte: day, lt: dayEnd }, status: "APPROVED" },
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

  return { snapshotsWritten, figuresUpdated };
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
      status: "APPROVED",
    },
    select: { amountUsd: true, soldAt: true },
  });

  if (recent.length === 0) {
    await prisma.figure.update({
      where: { id: figureId },
      data: { salesVolume90d: 0, lastAggregatedAt: new Date() },
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
export async function expireStaleListings(olderThanDays = 3): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86400_000);
  const result = await prisma.listing.updateMany({
    where: { isActive: true, lastSeen: { lt: cutoff } },
    data: { isActive: false },
  });
  return result.count;
}
