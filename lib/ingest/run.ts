import { prisma } from "../prisma";
import { toUsd } from "./fx";
import { isEbayConfigured, searchActiveListings, searchSoldItems, type EbayItem } from "./ebay";
import { isAmiAmiEnabled, searchAmiAmi } from "./amiami";
import { bestMatch, normalizeCondition, type MatchCandidate } from "./match";
import { loadCandidates } from "./candidates";
import { selectByPriority } from "./poll-priority";
import { expireStaleListings } from "./aggregate";

/**
 * The ingestion runner: for each figure in the catalog, ask each enabled source
 * what it currently has, match the results back to figures, and upsert them.
 *
 * Design notes:
 *   • Every source is wrapped so one failing provider can't abort the run.
 *   • Progress is written to IngestRun so failures are visible in the database
 *     rather than lost in a serverless log.
 *   • Listings upsert on (sourceId, externalId), so re-running is cheap and
 *     `lastSeen` doubles as the liveness signal for expireStaleListings().
 */

export type IngestOptions = {
  /** Which sources to run. Defaults to every enabled source. */
  sourceKeys?: string[];
  /** Cap figures processed, so a serverless invocation can't run past its timeout. */
  figureLimit?: number;
  /** Skip figures aggregated more recently than this many hours ago. */
  minAgeHours?: number;
};

export type IngestSummary = {
  source: string;
  itemsSeen: number;
  itemsUpserted: number;
  unmatched: number;
  error?: string;
};

/** The search string we send to a marketplace for a given figure. */
function buildQuery(figure: { name: string; manufacturerName: string | null }): string {
  // Manufacturer plus product name is what sellers actually type. Scale markers
  // like "1/7" survive normalization and help narrow results.
  return [figure.manufacturerName, figure.name].filter(Boolean).join(" ").slice(0, 100);
}

type FigureRow = {
  id: string;
  name: string;
  manufacturerName: string | null;
};

/**
 * Choose which figures to spend this run's marketplace calls on.
 *
 * This used to take the least-recently-aggregated figures, which stopped
 * working the moment the catalogue outgrew the quota. `lastAggregatedAt` only
 * moves for figures that *have* sales, so with seven thousand figures and
 * almost no sale data it was null nearly everywhere — the ordering was
 * arbitrary among thousands of ties, and the same figures could be picked
 * every run while others were never picked at all.
 *
 * Now it ranks on demand and staleness together; see poll-priority.ts. The
 * whole catalogue is read to do it, which is one query returning small rows
 * and cheap next to the API calls it is deciding.
 */
async function selectFigures(options: IngestOptions): Promise<FigureRow[]> {
  const cutoff = options.minAgeHours
    ? new Date(Date.now() - options.minAgeHours * 3600_000)
    : null;

  const rows = await prisma.figure.findMany({
    where: cutoff
      ? { OR: [{ lastPolledAt: null }, { lastPolledAt: { lt: cutoff } }] }
      : undefined,
    select: {
      id: true,
      name: true,
      viewCount: true,
      releaseDate: true,
      lastPolledAt: true,
      manufacturer: { select: { name: true } },
      _count: { select: { collectionItems: true, wishlistItems: true } },
    },
  });

  const ranked = selectByPriority(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      manufacturerName: r.manufacturer?.name ?? null,
      collectionCount: r._count.collectionItems,
      wishlistCount: r._count.wishlistItems,
      viewCount: r.viewCount,
      releaseDate: r.releaseDate,
      lastPolledAt: r.lastPolledAt,
    })),
    options.figureLimit ?? 200,
  );

  return ranked.map((r) => ({
    id: r.id,
    name: r.name,
    manufacturerName: r.manufacturerName,
  }));
}

export async function runIngestion(options: IngestOptions = {}): Promise<IngestSummary[]> {
  const sources = await prisma.source.findMany({
    where: {
      enabled: true,
      ...(options.sourceKeys ? { key: { in: options.sourceKeys } } : {}),
    },
  });

  const figures = await selectFigures(options);
  const candidates = await loadCandidates(true);
  const summaries: IngestSummary[] = [];

  for (const source of sources) {
    if (source.key === "user") continue; // community reports aren't fetched

    const run = await prisma.ingestRun.create({
      data: { sourceId: source.id, status: "running" },
    });

    const summary: IngestSummary = {
      source: source.key,
      itemsSeen: 0,
      itemsUpserted: 0,
      unmatched: 0,
    };

    try {
      if (source.key === "ebay") {
        await ingestEbay(source.id, figures, candidates, summary);
      } else if (source.key === "amiami") {
        await ingestAmiAmi(source.id, figures, candidates, summary);
      } else {
        console.info(`[ingest] no handler for source "${source.key}" — skipping`);
      }

      await prisma.ingestRun.update({
        where: { id: run.id },
        data: {
          status: "success",
          finishedAt: new Date(),
          itemsSeen: summary.itemsSeen,
          itemsUpserted: summary.itemsUpserted,
        },
      });
    } catch (err) {
      summary.error = err instanceof Error ? err.message : String(err);
      console.error(`[ingest] ${source.key} failed:`, err);

      await prisma.ingestRun.update({
        where: { id: run.id },
        data: {
          status: "error",
          finishedAt: new Date(),
          itemsSeen: summary.itemsSeen,
          itemsUpserted: summary.itemsUpserted,
          error: summary.error.slice(0, 1000),
        },
      });
    }

    summaries.push(summary);
  }

  const expired = await expireStaleListings();
  if (expired > 0) console.info(`[ingest] marked ${expired} stale listings inactive`);

  return summaries;
}

// --- Per-source handlers --------------------------------------------------

async function ingestEbay(
  sourceId: string,
  figures: FigureRow[],
  candidates: MatchCandidate[],
  summary: IngestSummary,
): Promise<void> {
  if (!isEbayConfigured()) {
    console.info("[ingest] eBay credentials not set — skipping");
    return;
  }

  for (const figure of figures) {
    const query = buildQuery(figure);

    const [active, sold] = await Promise.all([
      searchActiveListings(query, { limit: 40 }),
      searchSoldItems(query, { limit: 40 }),
    ]);

    summary.itemsSeen += active.length + sold.length;

    for (const item of active) {
      const matched = await upsertEbayListing(sourceId, item, candidates);
      if (matched) summary.itemsUpserted += 1;
      else summary.unmatched += 1;
    }

    for (const item of sold) {
      if (!item.soldAt) continue;
      const matched = await upsertEbaySale(sourceId, item, candidates);
      if (matched) summary.itemsUpserted += 1;
      else summary.unmatched += 1;
    }

    // Record the attempt, not the outcome. A search that found nothing still
    // used a call and still answers "what do we know about this figure right
    // now" — leaving it unrecorded would put the figure straight back at the
    // front of the queue and spend the same call again next run.
    await markPolled(figure.id);
  }
}

/** Note that a marketplace was searched for this figure. */
async function markPolled(figureId: string): Promise<void> {
  await prisma.figure.update({
    where: { id: figureId },
    data: { lastPolledAt: new Date() },
  });
}

async function upsertEbayListing(
  sourceId: string,
  item: EbayItem,
  candidates: MatchCandidate[],
): Promise<boolean> {
  const match = bestMatch(item.title, candidates);

  let converted;
  try {
    converted = await toUsd(item.amount, item.currency);
  } catch (err) {
    console.warn(`[ingest] skipping listing ${item.externalId}:`, err);
    return false;
  }

  let shippingUsd: number | null = null;
  if (item.shippingAmount !== null && item.shippingCurrency) {
    try {
      shippingUsd = (await toUsd(item.shippingAmount, item.shippingCurrency)).amountUsd;
    } catch {
      shippingUsd = null;
    }
  }

  const data = {
    figureId: match?.figureId ?? null,
    title: item.title,
    url: item.url,
    imageUrl: item.imageUrl,
    condition: normalizeCondition(item.conditionText),
    amount: item.amount,
    currency: item.currency,
    amountUsd: converted.amountUsd,
    fxRate: converted.fxRate,
    shippingUsd,
    matchScore: match?.score ?? null,
    isActive: true,
    lastSeen: new Date(),
  };

  await prisma.listing.upsert({
    where: { sourceId_externalId: { sourceId, externalId: item.externalId } },
    create: { sourceId, externalId: item.externalId, ...data },
    update: data,
  });

  return match !== null;
}

async function upsertEbaySale(
  sourceId: string,
  item: EbayItem,
  candidates: MatchCandidate[],
): Promise<boolean> {
  const match = bestMatch(item.title, candidates);
  if (!match || !item.soldAt) return false;

  let converted;
  try {
    converted = await toUsd(item.amount, item.currency);
  } catch {
    return false;
  }

  await prisma.sale.upsert({
    where: { sourceId_externalId: { sourceId, externalId: item.externalId } },
    create: {
      sourceId,
      externalId: item.externalId,
      figureId: match.figureId,
      title: item.title,
      url: item.url,
      condition: normalizeCondition(item.conditionText),
      amount: item.amount,
      currency: item.currency,
      amountUsd: converted.amountUsd,
      fxRate: converted.fxRate,
      soldAt: item.soldAt,
    },
    // Sales are immutable history — only re-link if matching improved.
    update: { figureId: match.figureId },
  });

  return true;
}

async function ingestAmiAmi(
  sourceId: string,
  figures: FigureRow[],
  candidates: MatchCandidate[],
  summary: IngestSummary,
): Promise<void> {
  if (!isAmiAmiEnabled()) {
    console.info("[ingest] AmiAmi disabled (set AMIAMI_ENABLED=true) — skipping");
    return;
  }

  for (const figure of figures) {
    const items = await searchAmiAmi(buildQuery(figure), 20);
    summary.itemsSeen += items.length;
    await markPolled(figure.id);

    for (const item of items) {
      const match = bestMatch(item.title, candidates);

      let converted;
      try {
        converted = await toUsd(item.amountJpy, "JPY");
      } catch (err) {
        console.warn(`[ingest] skipping AmiAmi ${item.externalId}:`, err);
        continue;
      }

      const data = {
        figureId: match?.figureId ?? null,
        title: item.title,
        url: item.url,
        imageUrl: item.imageUrl,
        condition: item.isPreowned ? ("USED_COMPLETE" as const) : ("NEW_SEALED" as const),
        amount: item.amountJpy,
        currency: "JPY",
        amountUsd: converted.amountUsd,
        fxRate: converted.fxRate,
        shippingUsd: null,
        matchScore: match?.score ?? null,
        isActive: item.inStock,
        lastSeen: new Date(),
      };

      await prisma.listing.upsert({
        where: { sourceId_externalId: { sourceId, externalId: item.externalId } },
        create: { sourceId, externalId: item.externalId, ...data },
        update: data,
      });

      if (match) {
        summary.itemsUpserted += 1;
        // AmiAmi list price is the best MSRP source we have — backfill it.
        if (item.listPriceJpy) {
          await prisma.figure.updateMany({
            where: { id: match.figureId, msrpAmount: null },
            data: { msrpAmount: item.listPriceJpy, msrpCurrency: "JPY" },
          });
        }
      } else {
        summary.unmatched += 1;
      }
    }
  }
}
