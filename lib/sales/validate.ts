/**
 * Screening for user-reported sales.
 *
 * This used to decide what got published: ordinary-looking reports went live
 * immediately and unusual ones waited for a human. That is what made sale
 * reporting worth removing — it left a published number a member of the public
 * could move, and the check that catches an invented price is the same check
 * that rejects a genuine bargain.
 *
 * So it no longer approves anything. Every report waits for a person, and this
 * decides what that person is told: "six times MSRP" is the sentence that makes
 * a queue of numbers reviewable. `APPROVED` here now means "nothing looks odd",
 * not "publish it".
 *
 * The hard bounds below are still refusals, because a price of zero or a sale
 * dated next year is a mistake rather than a judgement call.
 *
 * Everything here is pure — no database, no clock of its own — so it can be
 * unit tested exhaustively. See validate.test.ts.
 */

export const LIMITS = {
  /** Reports one account can file per day, across all figures. */
  maxPerUserPerDay: 20,
  /** Reports one account can file per day for a single figure. */
  maxPerFigurePerUserPerDay: 5,

  /** Outside these, we reject outright rather than queue for review. */
  hardMinUsd: 0.5,
  hardMaxUsd: 100_000,

  /** A sale can't be in the future, or older than this. */
  maxAgeYears: 10,

  /** Need at least this many prior sales before their median is a fair yardstick. */
  minReferenceSamples: 3,

  /** Auto-approve band when the yardstick is prior sales. */
  salesLowMultiple: 0.25,
  salesHighMultiple: 4,

  /**
   * Wider band when the yardstick is MSRP — a sought-after figure legitimately
   * trades at many times its retail price, and a heavily discounted one at a
   * fraction, so MSRP is only good for catching order-of-magnitude mistakes.
   */
  msrpLowMultiple: 0.2,
  msrpHighMultiple: 10,

  /** With no yardstick at all, anything above this gets a human look. */
  noReferenceCeilingUsd: 2_000,
} as const;

/** What we're comparing a report against. */
export type Reference =
  | { kind: "sales"; medianUsd: number; sampleSize: number }
  | { kind: "msrp"; usd: number }
  | { kind: "none" };

export type Screening = {
  status: "APPROVED" | "PENDING_REVIEW";
  /** Human-readable explanation, shown to the reporter and the moderator. */
  flagReason: string | null;
};

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * Decide whether a report can go live immediately.
 *
 * Assumes `amountUsd` already passed `validateReport` — this only judges
 * plausibility, not well-formedness.
 */
export function screenReportedSale(amountUsd: number, reference: Reference): Screening {
  if (reference.kind === "sales" && reference.sampleSize >= LIMITS.minReferenceSamples) {
    const low = reference.medianUsd * LIMITS.salesLowMultiple;
    const high = reference.medianUsd * LIMITS.salesHighMultiple;

    if (amountUsd < low) {
      return {
        status: "PENDING_REVIEW",
        flagReason: `${money(amountUsd)} is far below the recent median of ${money(reference.medianUsd)} for this figure and condition.`,
      };
    }
    if (amountUsd > high) {
      return {
        status: "PENDING_REVIEW",
        flagReason: `${money(amountUsd)} is far above the recent median of ${money(reference.medianUsd)} for this figure and condition.`,
      };
    }
    return { status: "APPROVED", flagReason: null };
  }

  if (reference.kind === "msrp") {
    const low = reference.usd * LIMITS.msrpLowMultiple;
    const high = reference.usd * LIMITS.msrpHighMultiple;

    if (amountUsd < low || amountUsd > high) {
      return {
        status: "PENDING_REVIEW",
        flagReason: `${money(amountUsd)} is a long way from this figure's retail price of ${money(reference.usd)}, and there aren't enough recorded sales to compare against yet.`,
      };
    }
    return { status: "APPROVED", flagReason: null };
  }

  // Nothing to compare against — a brand-new figure, or too few sales.
  if (amountUsd > LIMITS.noReferenceCeilingUsd) {
    return {
      status: "PENDING_REVIEW",
      flagReason: `We have no price history for this figure yet, so reports above ${money(LIMITS.noReferenceCeilingUsd)} are checked by a moderator first.`,
    };
  }
  return { status: "APPROVED", flagReason: null };
}

export type ReportInput = {
  amountUsd: number;
  soldAt: Date;
};

export type ValidationError = { field: "amount" | "soldAt"; message: string };

/**
 * Well-formedness checks. These reject outright — unlike screening, there's no
 * plausible reading under which a negative price or a future sale is real.
 *
 * `now` is a parameter so tests don't depend on the wall clock.
 */
export function validateReport(input: ReportInput, now: Date): ValidationError | null {
  if (!Number.isFinite(input.amountUsd)) {
    return { field: "amount", message: "Enter a valid price." };
  }
  if (input.amountUsd < LIMITS.hardMinUsd) {
    return { field: "amount", message: `Price must be at least ${money(LIMITS.hardMinUsd)}.` };
  }
  if (input.amountUsd > LIMITS.hardMaxUsd) {
    return {
      field: "amount",
      message: `Price must be under ${money(LIMITS.hardMaxUsd)}. If this is genuinely correct, contact us.`,
    };
  }

  if (Number.isNaN(input.soldAt.getTime())) {
    return { field: "soldAt", message: "Enter a valid date." };
  }
  // Allow a day of slack so a buyer in a timezone ahead of UTC isn't rejected.
  const tomorrow = new Date(now.getTime() + 86400_000);
  if (input.soldAt > tomorrow) {
    return { field: "soldAt", message: "The sale date can't be in the future." };
  }

  const oldest = new Date(now);
  oldest.setUTCFullYear(oldest.getUTCFullYear() - LIMITS.maxAgeYears);
  if (input.soldAt < oldest) {
    return {
      field: "soldAt",
      message: `Sales older than ${LIMITS.maxAgeYears} years aren't useful for current pricing.`,
    };
  }

  return null;
}

export type RateLimitState = {
  reportsToday: number;
  reportsTodayForFigure: number;
};

/** Null when the user may file another report, else the reason they can't. */
export function checkRateLimit(state: RateLimitState): string | null {
  if (state.reportsToday >= LIMITS.maxPerUserPerDay) {
    return `You've reported ${LIMITS.maxPerUserPerDay} sales today, which is the daily limit. Try again tomorrow.`;
  }
  if (state.reportsTodayForFigure >= LIMITS.maxPerFigurePerUserPerDay) {
    return `You've already reported ${LIMITS.maxPerFigurePerUserPerDay} sales for this figure today.`;
  }
  return null;
}
