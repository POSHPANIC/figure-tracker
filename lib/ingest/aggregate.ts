import { prisma } from "../prisma";
import { pruneRateLimits } from "../rate-limit-store";
import { toUsd } from "./fx";
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

  // The same numbers, kept rather than overwritten, so there is a series to
  // chart tomorrow. Figure.askMedianUsd answers "what is it worth now"; these
  // rows answer "what has it been doing".
  const askSnapshots = await writeAskSnapshots();
  snapshotsWritten += askSnapshots;
  if (askSnapshots > 0) console.info(`[aggregate] wrote ${askSnapshots} asking-price snapshots`);

  // Keep search in step with any catalogue metadata that changed today.
  const reindexed = await rebuildAllSearchText();
  if (reindexed > 0) console.info(`[aggregate] refreshed search text for ${reindexed} figures`);

  return { snapshotsWritten, figuresUpdated };
}

/**
 * Record what sellers are asking today, one row per figure.
 *
 * This is the series the chart draws, and until this existed there was nothing
 * to draw. Snapshots were only written for a figure that *sold* something that
 * day, so with no sold-price source anywhere in this category the loop never
 * ran once: the asking prices were queried every night and thrown away, and
 * PriceSnapshot held zero rows against 128,087 listings.
 *
 * Deliberately the same rules as `recomputeAskingPrices` — same match
 * threshold, same minimum sample, same NEW_SEALED filter, same median. If they
 * drifted apart, the last point on the chart would disagree with the figure
 * printed above it, and both would look wrong.
 *
 * Dated today rather than yesterday, unlike the sales it sits beside. A sale
 * happened on a day; an asking price is what we can see at the moment we look.
 *
 * Idempotent for the day: the day's asking figures are cleared first, so
 * re-running never leaves a figure holding numbers it no longer earns.
 *
 * Three statements for the whole catalogue.
 */
export async function writeAskSnapshots(forDay?: Date): Promise<number> {
  const day = startOfUtcDay(forDay ?? new Date());

  // Clear the day's asking figures before writing them.
  //
  // INSERT ... ON CONFLICT only touches rows the query produces, so a figure
  // that stops qualifying — its listings sold, or were found not to be its
  // listings at all — kept whichever numbers it had when it last did. Nendoroid
  // Racing Miku 2019 sat at a median of $15 from two keychain bundles for a
  // whole day after those were taken off it, because nothing ever went back to
  // remove the row.
  //
  // Two statements rather than one because a row can also carry sales: those
  // are deleted only when the asking figures were all it held.
  await prisma.$executeRaw`
    UPDATE "PriceSnapshot"
    SET "askMinUsd" = NULL, "askMedianUsd" = NULL, "askMaxUsd" = NULL,
        "askCount" = NULL, "lowestAskUsd" = NULL
    WHERE date = ${day}::date AND "medianUsd" IS NOT NULL
  `;
  await prisma.$executeRaw`
    DELETE FROM "PriceSnapshot" WHERE date = ${day}::date AND "medianUsd" IS NULL
  `;

  return prisma.$executeRaw`
    INSERT INTO "PriceSnapshot" (
      id, "figureId", condition, date,
      "askMinUsd", "askMedianUsd", "askMaxUsd", "askCount", "lowestAskUsd"
    )
    SELECT
      gen_random_uuid()::text,
      "figureId",
      'NEW_SEALED'::"ItemCondition",
      ${day}::date,
      round(min("amountUsd")::numeric, 2),
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY "amountUsd")::numeric, 2),
      round(max("amountUsd")::numeric, 2),
      count(*)::int,
      round(min("amountUsd")::numeric, 2)
    FROM "Listing"
    WHERE "figureId" IS NOT NULL
      AND "isActive"
      AND condition = 'NEW_SEALED'
      AND "matchScore" >= ${ASK_MIN_MATCH_SCORE}
    GROUP BY "figureId"
    HAVING count(*) >= ${ASK_MIN_LISTINGS}
    ON CONFLICT ("figureId", condition, date) DO UPDATE SET
      "askMinUsd"    = EXCLUDED."askMinUsd",
      "askMedianUsd" = EXCLUDED."askMedianUsd",
      "askMaxUsd"    = EXCLUDED."askMaxUsd",
      "askCount"     = EXCLUDED."askCount",
      "lowestAskUsd" = EXCLUDED."lowestAskUsd"
  `;
}

/**
 * How confident the matcher has to be before a listing counts toward the asking
 * price.
 *
 * Still stricter than MATCH_ACCEPT_THRESHOLD, which is 0.6 — a listing shown in
 * a list is one a reader can judge for themselves, while a listing folded into
 * a published number is one nobody can see, so showing more than we average
 * over stays the right way round.
 *
 * This was 0.8, chosen to keep the median's sample clean: it pulled the median
 * spread between a figure's cheapest and dearest listing from 2.46x to 2.02x,
 * and cut the figures showing a tenfold spread from 239 to 82. Those numbers
 * were real, but they measured tightness rather than accuracy, and 0.8 was
 * buying that tightness by discarding correct matches.
 *
 * What it discarded: sellers who name the series are penalised for it, because
 * the extra words dilute the score. "Nendoroid Saekano Fine Eriri Spencer
 * Sawamura Kimono Ver." scores 0.75 against the figure it plainly is. Eriri's
 * page listed 11 new/sealed listings and priced from 3 of them, publishing an
 * $80 median against a real spread of $70-$103. Of 14 excluded listings sampled
 * at random, 13 were correct; the one that was not matched a Nendoroid Doll to
 * a Nendoroid.
 *
 * And 701 figures held three or more new/sealed listings while showing no price
 * at all, because every listing they had sat below 0.8.
 *
 * 0.72 rather than 0.6 because the 0.6-0.71 band is where the genuinely
 * doubtful matches live. The right fix is to stop docking sellers for naming
 * the series, which is being worked through by hand; this is the floor until
 * then, not a verdict on what a confident match is.
 */
const ASK_MIN_MATCH_SCORE = 0.72;

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
  const now = Date.now();
  const d90 = new Date(now - 90 * 86400_000);

  // Only a figure with a sale in the window can have a value at all, so ask for
  // the sales rather than for the figures. This used to walk the whole
  // catalogue one row at a time: 7,387 selects and 7,387 updates a night, and
  // because the catalogue has no sold prices at all, every one of those updates
  // wrote the same nulls back over the nulls already there. It cost a nightly
  // flood of round trips to change nothing, and could not finish inside the
  // function's sixty seconds.
  const sales = await prisma.sale.findMany({
    where: { condition: "NEW_SEALED", soldAt: { gte: d90 } },
    select: { figureId: true, amountUsd: true, soldAt: true },
  });

  const byFigure = new Map<string, { amountUsd: unknown; soldAt: Date }[]>();
  for (const sale of sales) {
    const rows = byFigure.get(sale.figureId);
    if (rows) rows.push(sale);
    else byFigure.set(sale.figureId, [sale]);
  }

  const withSales = [...byFigure.keys()];

  // Everyone else has no value, cleared in one statement. The OR guard means it
  // writes only the rows that actually change, so a night where nothing sold
  // updates nothing rather than rewriting the catalogue.
  await prisma.figure.updateMany({
    where: {
      ...(withSales.length ? { id: { notIn: withSales } } : {}),
      OR: [
        { marketValueUsd: { not: null } },
        { change30dPct: { not: null } },
        { NOT: { salesVolume90d: 0 } },
      ],
    },
    data: {
      marketValueUsd: null,
      change30dPct: null,
      salesVolume90d: 0,
      lastAggregatedAt: new Date(),
    },
  });

  let updated = 0;
  for (const [figureId, rows] of byFigure) {
    if (await writeFigureStats(figureId, rows, now)) updated += 1;
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
  const d90 = new Date(now - 90 * 86400_000);

  const recent = await prisma.sale.findMany({
    where: {
      figureId,
      condition: "NEW_SEALED",
      soldAt: { gte: d90 },
    },
    select: { amountUsd: true, soldAt: true },
  });

  return writeFigureStats(figureId, recent, now);
}

/**
 * Write one figure's statistics from sales already in hand.
 *
 * Split out so the nightly job and the moderation path share the arithmetic
 * while fetching differently: the nightly job reads every relevant sale in one
 * query, and a moderator approving a single sale reads only that figure's.
 */
async function writeFigureStats(
  figureId: string,
  recent: { amountUsd: unknown; soldAt: Date }[],
  now: number,
): Promise<boolean> {
  const d30 = new Date(now - 30 * 86400_000);
  const d60 = new Date(now - 60 * 86400_000);

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

  const asNumber = (v: unknown) => Number(String(v));
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

/**
 * Keep msrpUsd in step with the price the maker announced.
 *
 * The dollar figure is derived, so it is rebuilt rather than edited: an
 * importer that corrects an MSRP writes the amount and the currency and knows
 * nothing about this column.
 *
 * Only for figures that have not come out yet, which is the only place
 * figureValue() reads it. That bound is what makes the job cheap and stable.
 * 6,971 of the 7,510 recorded MSRPs are in yen, so converting all of them at
 * today's rate would rewrite most of the catalogue every night as JPY drifts,
 * to keep a column nothing reads. Bounded to the unreleased, it is a few
 * hundred rows that mostly do not move.
 *
 * Converted at today's rate rather than the release month's -- the opposite of
 * the MSRP row on a figure page, and deliberately. There is no release month to
 * look up for something that has not been released, and the question this
 * number answers is what it costs now.
 *
 * A currency with no rate is left alone rather than guessed at. Silence is
 * recoverable; a wrong rate misprices a figure on every screen at once.
 */
export async function recomputeMsrpUsd(
  now = new Date(),
): Promise<{ written: number; cleared: number; unconvertible: number }> {
  const rows = await prisma.figure.findMany({
    where: {
      msrpAmount: { not: null },
      msrpCurrency: { not: null },
      releaseDate: { gt: now },
    },
    select: { id: true, msrpAmount: true, msrpCurrency: true, msrpUsd: true },
  });

  let unconvertible = 0;
  // Grouped by the value to write, so this is a handful of statements rather
  // than one per figure. Most figures in a line share a list price.
  const byValue = new Map<number, string[]>();

  for (const r of rows) {
    const amount = Number(String(r.msrpAmount));
    if (!Number.isFinite(amount) || amount <= 0) continue;

    let usd: number;
    try {
      usd = (await toUsd(amount, r.msrpCurrency!)).amountUsd;
    } catch {
      unconvertible += 1;
      continue;
    }

    // Only when it actually moved, or updatedAt churns for nothing.
    const held = r.msrpUsd === null ? null : Number(String(r.msrpUsd));
    if (held !== null && Math.abs(held - usd) < 0.005) continue;

    byValue.set(usd, [...(byValue.get(usd) ?? []), r.id]);
  }

  let written = 0;
  for (const [usd, ids] of byValue) {
    for (let i = 0; i < ids.length; i += 500) {
      const slice = ids.slice(i, i + 500);
      await prisma.figure.updateMany({ where: { id: { in: slice } }, data: { msrpUsd: usd } });
      written += slice.length;
    }
  }

  // And drop it everywhere it is no longer read, so the column keeps meaning
  // "the list price of something you cannot buy yet". A run of this job that
  // was not bounded to the unreleased left 5,301 of these behind.
  const { count: cleared } = await prisma.figure.updateMany({
    where: { msrpUsd: { not: null }, OR: [{ releaseDate: null }, { releaseDate: { lte: now } }] },
    data: { msrpUsd: null },
  });

  return { written, cleared, unconvertible };
}
