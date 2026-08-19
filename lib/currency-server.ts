import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { loadRates, monthlyRateToUsd } from "./ingest/fx";
import {
  CURRENCY_COOKIE,
  DEFAULT_CURRENCY,
  USD_MONEY,
  isSupportedCurrency,
  type CurrencyCode,
  type DisplayMoney,
} from "./currency";

/**
 * Resolves the visitor's display currency for the current request.
 *
 * Wrapped in React's `cache`, so every server component in a render can just
 * call it rather than having the value threaded down through props — one cookie
 * read and one rate lookup per request no matter how many components ask.
 */
export const getDisplayMoney = cache(async (): Promise<DisplayMoney> => {
  const store = await cookies();
  const chosen = store.get(CURRENCY_COOKIE)?.value;

  if (!isSupportedCurrency(chosen) || chosen === DEFAULT_CURRENCY) return USD_MONEY;

  try {
    const rates = await loadRates();
    const rateToUsd = rates.get(chosen);

    // A rate of zero or a missing currency would silently zero every price on
    // the page, so fall back to USD rather than render nonsense.
    if (!rateToUsd || rateToUsd <= 0) {
      console.warn(`[currency] no usable rate for ${chosen}, showing USD`);
      return USD_MONEY;
    }

    return { currency: chosen, usdToDisplay: 1 / rateToUsd };
  } catch (err) {
    console.error("[currency] rate lookup failed, showing USD:", err);
    return USD_MONEY;
  }
});

/**
 * What rate produced a converted figure.
 *
 * The page says which one it used. "≈ $41" alone invites the reader to compare
 * it against a market value quoted in today's dollars, and subtracting prices
 * from two different eras gives a number that means nothing.
 */
export type RateBasis = "release" | "today";

export type HistoricalConversion = { usd: number; basis: RateBasis };

/**
 * Convert a price that was set in the past into the currency being displayed.
 *
 * Both legs of the conversion go through the same month. A ¥3,143 figure from
 * October 2011 shown in euros has to answer "what would a European have paid
 * then" — €30, at 2011's rates on both sides. Converting the yen at 2011 and
 * then the dollars at today's rate gives €35, a number from no single moment
 * that the "at release" label would quietly misdescribe.
 *
 * Falls back to today's rates — and says so, through `basis` — when we hold no
 * rate for that month: a figure due next year, or a price with no date on it.
 *
 * Returns null when there is no rate at all, so callers show the native price
 * alone rather than an invented conversion.
 */
export async function historicalMoney(
  amount: number,
  currency: string,
  when: Date | null,
  display: CurrencyCode,
): Promise<{ amount: number; basis: RateBasis } | null> {
  const code = currency.toUpperCase();
  if (code === display) return { amount, basis: when ? "release" : "today" };

  try {
    if (when) {
      const [fromRate, toRate] = await Promise.all([
        monthlyRateToUsd(code, when),
        monthlyRateToUsd(display, when),
      ]);
      // Both or neither. One leg at the release rate and one at today's is a
      // number from no single moment, and the label would misdescribe it.
      if (fromRate && toRate) {
        return { amount: (amount * fromRate) / toRate, basis: "release" };
      }
    }

    const rates = await loadRates();
    const fromRate = code === "USD" ? 1 : rates.get(code);
    const toRate = display === "USD" ? 1 : rates.get(display);
    if (!fromRate || !toRate || fromRate <= 0 || toRate <= 0) return null;
    return { amount: (amount * fromRate) / toRate, basis: "today" };
  } catch {
    return null;
  }
}
