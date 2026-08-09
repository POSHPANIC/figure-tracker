import { prisma } from "../prisma";
import { toUsd } from "../ingest/fx";
import { median } from "../ingest/aggregate";
import { LIMITS, type Reference } from "./validate";
import type { ItemCondition } from "../generated/prisma/enums";

/**
 * Builds the yardstick a reported sale is screened against.
 *
 * Preference order:
 *   1. Approved sales of the same figure in the same condition — the only true
 *      like-for-like comparison.
 *   2. MSRP, converted to USD. Weak, but catches order-of-magnitude typos on
 *      figures with no trading history yet.
 *   3. Nothing, in which case screening falls back to an absolute ceiling.
 *
 * Deliberately scoped to one condition: a sealed copy and a damaged one trade
 * at very different prices, and comparing across them would flag honest reports.
 */
export async function buildReference(
  figureId: string,
  condition: ItemCondition,
): Promise<Reference> {
  const since = new Date(Date.now() - 365 * 86400_000);

  const sales = await prisma.sale.findMany({
    where: { figureId, condition, status: "APPROVED", soldAt: { gte: since } },
    select: { amountUsd: true },
    // Cap the read — a median over the most recent few hundred is as good as
    // one over ten thousand, and far cheaper.
    orderBy: { soldAt: "desc" },
    take: 500,
  });

  if (sales.length >= LIMITS.minReferenceSamples) {
    return {
      kind: "sales",
      medianUsd: median(sales.map((s) => Number(s.amountUsd))),
      sampleSize: sales.length,
    };
  }

  const figure = await prisma.figure.findUnique({
    where: { id: figureId },
    select: { msrpAmount: true, msrpCurrency: true },
  });

  if (figure?.msrpAmount && figure.msrpCurrency) {
    try {
      const { amountUsd } = await toUsd(Number(figure.msrpAmount), figure.msrpCurrency);
      if (amountUsd > 0) return { kind: "msrp", usd: amountUsd };
    } catch {
      // No FX rate for that currency — fall through to no reference rather than
      // screening against a number we can't trust.
    }
  }

  return { kind: "none" };
}
