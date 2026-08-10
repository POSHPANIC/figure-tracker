/**
 * Money helpers.
 *
 * Every price in the database is stored twice: the original `amount`/`currency`
 * as advertised by the marketplace, and `amountUsd` normalized at ingest time.
 * Display code should read amountUsd; only the "original price" badge on a
 * listing uses the raw amount.
 *
 * Prisma returns Decimal columns as `Prisma.Decimal`, which is not a JS number.
 * `toNumber` below is the single place we cross that boundary.
 */

/** Currencies with no minor unit — 500 JPY is 500 yen, not 5.00. */
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK"]);

type DecimalLike = { toString(): string } | number | string | null | undefined;

/** Convert a Prisma Decimal (or anything stringifiable) to a plain number. */
export function toNumber(value: DecimalLike): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

export function formatUsd(value: DecimalLike, opts?: { compact?: boolean }): string {
  const n = toNumber(value);
  if (n === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: opts?.compact ? "compact" : "standard",
    maximumFractionDigits: opts?.compact ? 1 : 2,
    minimumFractionDigits: opts?.compact ? 0 : 2,
  }).format(n);
}

export function formatCurrency(
  value: DecimalLike,
  currency: string,
  opts?: { compact?: boolean },
): string {
  const n = toNumber(value);
  if (n === null) return "—";

  // Yen has no minor unit, so "¥21,800.00" is simply wrong.
  const zeroDecimal = ZERO_DECIMAL.has(currency.toUpperCase());
  const digits = zeroDecimal ? 0 : 2;

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      notation: opts?.compact ? "compact" : "standard",
      maximumFractionDigits: opts?.compact ? 1 : digits,
      minimumFractionDigits: opts?.compact ? 0 : digits,
    }).format(n);
  } catch {
    // Unknown/invalid ISO code — fall back to a plain number plus the raw code.
    return `${n.toFixed(digits)} ${currency.toUpperCase()}`;
  }
}

/** "+12.5%" / "-3.0%" / "—" */
export function formatPercent(value: DecimalLike): string {
  const n = toNumber(value);
  if (n === null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

export type Trend = "up" | "down" | "flat";

export function trendOf(value: DecimalLike): Trend {
  const n = toNumber(value);
  if (n === null || Math.abs(n) < 0.05) return "flat";
  return n > 0 ? "up" : "down";
}
