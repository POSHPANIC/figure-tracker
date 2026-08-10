import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { loadRates } from "./ingest/fx";
import {
  CURRENCY_COOKIE,
  DEFAULT_CURRENCY,
  USD_MONEY,
  isSupportedCurrency,
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
 * Convert an amount in its own currency to USD, for values stored only in
 * their native form — chiefly MSRP.
 *
 * Returns null when there's no rate, so callers show the native price alone
 * rather than an invented conversion.
 */
export async function nativeToUsd(
  amount: number,
  currency: string,
): Promise<number | null> {
  const code = currency.toUpperCase();
  if (code === "USD") return amount;

  try {
    const rates = await loadRates();
    const rateToUsd = rates.get(code);
    if (!rateToUsd || rateToUsd <= 0) return null;
    return amount * rateToUsd;
  } catch {
    return null;
  }
}
