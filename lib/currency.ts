import { formatCurrency, toNumber } from "./money";

/**
 * Display currency.
 *
 * Prices are *stored* in two forms — the original amount as advertised, and a
 * USD figure converted at the rate on the day we saw it. Aggregates (market
 * value, chart points, all-time high) exist only in USD, because averaging
 * across mixed currencies is meaningless any other way.
 *
 * Displaying those in a third currency therefore means a second conversion,
 * and every conversion loses a little. Two consequences shape this file:
 *
 *   1. Where the original amount is available and happens to match the
 *      currency being displayed, show the original. Round-tripping ¥25,000
 *      through USD and back gives ¥24,997, which looks like a bug to the
 *      person who typed 25,000.
 *   2. Converted values are marked approximate. They are estimates of an
 *      estimate, and the UI shouldn't imply otherwise.
 */

export const SUPPORTED_CURRENCIES = [
  { code: "USD", label: "US Dollar" },
  { code: "JPY", label: "Japanese Yen" },
  { code: "EUR", label: "Euro" },
  { code: "GBP", label: "British Pound" },
  { code: "CAD", label: "Canadian Dollar" },
  { code: "AUD", label: "Australian Dollar" },
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]["code"];

export const DEFAULT_CURRENCY: CurrencyCode = "USD";

/** Cookie holding the visitor's choice. Readable server-side, so no flash. */
export const CURRENCY_COOKIE = "ft_currency";

/** A year — this is a preference, not a session. */
export const CURRENCY_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isSupportedCurrency(code: string | undefined | null): code is CurrencyCode {
  return Boolean(code) && SUPPORTED_CURRENCIES.some((c) => c.code === code);
}

/**
 * Everything a component needs to render prices, small enough to hand to a
 * client component without shipping a whole rate table.
 */
export type DisplayMoney = {
  currency: CurrencyCode;
  /** Multiply a USD amount by this to get the display currency. */
  usdToDisplay: number;
};

export const USD_MONEY: DisplayMoney = { currency: "USD", usdToDisplay: 1 };

type DecimalLike = { toString(): string } | number | string | null | undefined;

/** The original amount as advertised, when we have it. */
export type OriginalAmount = { amount: DecimalLike; currency: string | null } | null | undefined;

/**
 * Format a USD-denominated amount in the visitor's chosen currency.
 *
 * Pass `original` wherever the source amount is known (listings, sales,
 * purchase prices). When it's already in the display currency it's shown
 * verbatim instead of being converted twice.
 */
export function formatMoney(
  amountUsd: DecimalLike,
  money: DisplayMoney,
  opts?: { compact?: boolean; original?: OriginalAmount },
): string {
  const original = opts?.original;
  if (original?.currency && original.currency.toUpperCase() === money.currency) {
    const exact = toNumber(original.amount);
    if (exact !== null) return formatCurrency(exact, money.currency);
  }

  const usd = toNumber(amountUsd);
  if (usd === null) return "—";

  const converted = usd * money.usdToDisplay;
  return formatCurrency(converted, money.currency, { compact: opts?.compact });
}

/** True when a value shown in `money` had to be converted to get there. */
export function isConverted(money: DisplayMoney, sourceCurrency: string | null): boolean {
  if (!sourceCurrency) return money.currency !== "USD";
  return sourceCurrency.toUpperCase() !== money.currency;
}

/**
 * "≈ €133" — the marker for a converted figure.
 *
 * Used beside a native price rather than replacing it, so the number the
 * manufacturer actually set stays the one being quoted.
 */
export function approx(formatted: string): string {
  return `≈ ${formatted}`;
}

/**
 * "≈ $41 at release" — a converted figure, and which rate produced it.
 *
 * Naming the rate is what stops the number being read as comparable to a market
 * value quoted in today's money. Both are true; they answer different
 * questions, and the difference is 40% for the median figure here.
 */
export function approxAt(formatted: string, basis: "release" | "today"): string {
  return `${approx(formatted)} ${basis === "release" ? "at release" : "at today’s rate"}`;
}
