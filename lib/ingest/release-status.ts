/**
 * When a release date counts as having passed.
 *
 * The rule half of markReleased(), kept free of the database so it can be
 * tested without one -- the same split as same-product.ts and enrich.ts.
 */

/**
 * The instants before which a release date has definitely passed.
 *
 * Two, because a date means different things at different precisions. A DAY
 * date is the day itself, so yesterday is out. A MONTH date is stored as the
 * first of the month and means the whole month, so a figure dated the 1st of
 * this month has not missed anything yet -- it ships somewhere in the next few
 * weeks. Flipping it on the 1st would call it released for the whole month it
 * was actually released in.
 */
export function releasedBefore(now: Date): { day: Date; month: Date } {
  return {
    day: now,
    month: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  };
}
