import { releasedBefore } from "./release-status";

/**
 * A figure's printings, and whether a reissue is still to come.
 *
 * The rule half of the Releases card and of the reissue-preorder status, kept
 * free of the database like release-status.ts and enrich.ts.
 */

/** A FigureRelease row, or the figure's own printing, as far as these rules need. */
export type Printing = {
  kind: string;
  label: string | null;
  releaseDate: Date | string | null;
  releaseDatePrecision: string;
  preorderOpensAt?: Date | string | null;
  preorderClosesAt?: Date | string | null;
  priceAmount: unknown;
  priceCurrency: string | null;
  jan?: string | null;
};

const asDate = (d: Date | string | null | undefined): Date | null => {
  if (!d) return null;
  const v = d instanceof Date ? d : new Date(d);
  return Number.isNaN(v.getTime()) ? null : v;
};

/** Whether a printing has shipped, at the precision its date was given in. */
export function hasShipped(p: Pick<Printing, "releaseDate" | "releaseDatePrecision">, now = new Date()): boolean {
  const at = asDate(p.releaseDate);
  if (!at) return false;
  const cutoff = releasedBefore(now);
  return at < (p.releaseDatePrecision === "DAY" ? cutoff.day : cutoff.month);
}

/**
 * The reissue still to come, if there is one: the soonest that has not shipped.
 *
 * Undated counts only while its preorder window is open or ahead. An undated
 * reissue whose orders closed long ago is a gap in the source, not a release
 * anyone is waiting for, and calling the figure a preorder on it would be
 * wrong for good.
 */
export function upcomingReissue<P extends Printing>(rows: readonly P[], now = new Date()): P | null {
  const waiting = rows.filter((r) => {
    if (r.kind === "original") return false;
    if (asDate(r.releaseDate)) return !hasShipped(r, now);
    const closes = asDate(r.preorderClosesAt);
    return closes !== null && closes > now;
  });
  waiting.sort((a, b) => (asDate(a.releaseDate)?.getTime() ?? Infinity) - (asDate(b.releaseDate)?.getTime() ?? Infinity));
  return waiting[0] ?? null;
}

/**
 * Every printing of a figure, oldest first, for the Releases card.
 *
 * The figure's own fields describe one printing and the rows the rest. A row
 * the source calls the original is the same printing as the figure's own, and
 * is folded into it rather than listed twice -- it is where the original's
 * barcode and preorder window come from. A folded entry that is older than the
 * figure it was folded into is the original instead, and the figure's own
 * printing is then the later one.
 */
export function printings(own: Printing, rows: readonly Printing[]): (Printing & { label: string; own: boolean })[] {
  const merged: Printing = { ...own };
  const rest: Printing[] = [];
  for (const r of rows) {
    if (r.kind === "original" && sameMonth(r.releaseDate, own.releaseDate)) {
      merged.preorderOpensAt ??= r.preorderOpensAt;
      merged.preorderClosesAt ??= r.preorderClosesAt;
      // The source's barcode for this printing beats the figure's own: a figure
      // holds whichever barcode it was found by first, and for Insane Black Rock
      // Shooter that was the 2025 rerelease's, not the 2013 original's.
      merged.jan = r.jan ?? merged.jan;
      if (!asDate(merged.releaseDate)) {
        merged.releaseDate = r.releaseDate;
        merged.releaseDatePrecision = r.releaseDatePrecision;
      }
      if (merged.priceAmount == null) {
        merged.priceAmount = r.priceAmount;
        merged.priceCurrency = r.priceCurrency;
      }
    } else {
      rest.push(r);
    }
  }
  const all = [{ ...merged, own: true }, ...rest.map((r) => ({ ...r, own: false }))].sort(
    (a, b) => (asDate(a.releaseDate)?.getTime() ?? Infinity) - (asDate(b.releaseDate)?.getTime() ?? Infinity),
  );
  return all.map((p, i) => ({ ...p, label: i === 0 ? "Original" : p.label ?? "Reissue" }));
}

function sameMonth(a: Date | string | null, b: Date | string | null): boolean {
  const x = asDate(a);
  const y = asDate(b);
  if (!x || !y) return !x && !y ? false : !y;
  return x.getUTCFullYear() === y.getUTCFullYear() && x.getUTCMonth() === y.getUTCMonth();
}

/**
 * Whether two catalogue entries for one product are two printings of it.
 *
 * Folding merges both: Good Smile's archive entry for a reissue, and the same
 * printing imported twice by shops that share no identifier. Only the first is
 * a release. Shops date the same printing differently -- Solaris to the end of
 * a month, Kotobukiya to its middle, and both drift as a release slips -- so
 * PUNI☆MOFU Tu arrived as May and as June 2027. A reissue is a year or more
 * on. Three months separates the two with room on both sides.
 */
export function isSeparatePrinting(a: Date | string | null, b: Date | string | null): boolean {
  const x = asDate(a);
  const y = asDate(b);
  if (!x || !y) return false;
  return Math.abs(x.getTime() - y.getTime()) > 92 * 86_400_000;
}
