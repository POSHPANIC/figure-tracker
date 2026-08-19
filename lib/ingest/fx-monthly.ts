/**
 * Converting a price that was set in the past.
 *
 * A figure's MSRP is a historical fact: the manufacturer set ¥3,200 in October
 * 2011, when a dollar bought 76 yen. Converting that at today's 158 says the
 * figure retailed for $20 when it retailed for $41. Across this catalogue that
 * is not a rounding quibble — two thirds of MSRPs move by more than a quarter,
 * and the median moves by 40%.
 *
 * So historical prices convert at the rate of the month they were set, and the
 * page says which rate it used. Live prices — listings, sales — keep converting
 * at the rate on the day we saw them, which `fx.ts` already handles.
 *
 * The unit is a month, not a day, because the prices this serves are only known
 * to the month: the catalogue's release dates carry a placeholder day of 15
 * (scripts/import-gsc.ts). Averaging the month refuses a precision the source
 * never had, and is steadier for it.
 */

/** Rates come from central banks via Frankfurter, which needs no API key. */
const SERIES_URL = "https://api.frankfurter.dev/v1";

/** The earliest date the provider carries for the currencies we display. */
export const EARLIEST_MONTH = "1999-01";

export type MonthlyRate = { rateToUsd: number; days: number };

/** The first of the month, UTC — how a month is stored. */
export function monthStart(when: Date): Date {
  return new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), 1));
}

/** "2016-03" for a date, which is how these are keyed in memory. */
export function monthKey(when: Date): string {
  return when.toISOString().slice(0, 7);
}

/**
 * Average daily quotes into one rate per currency per month.
 *
 * Input is the provider's shape: how many units of the currency one USD buys.
 * Output is the inverse, the multiplier that takes an amount in that currency
 * to USD, which is what the rest of the code wants.
 *
 * Months with no quotes simply do not appear. A month present with a handful of
 * days is kept — the provider publishes on business days, so a short month is
 * normal — but the count travels with it so a genuinely thin month is visible
 * rather than silently averaged from one number.
 */
export function averageByMonth(
  quotes: Record<string, Record<string, number>>,
): Map<string, Map<string, MonthlyRate>> {
  const totals = new Map<string, Map<string, { sum: number; days: number }>>();

  for (const [day, byCurrency] of Object.entries(quotes)) {
    const month = day.slice(0, 7);
    for (const [rawCode, perUsd] of Object.entries(byCurrency)) {
      if (typeof perUsd !== "number" || !(perUsd > 0)) continue;
      const code = rawCode.toUpperCase();
      const forCode = totals.get(code) ?? new Map();
      totals.set(code, forCode);
      const cell = forCode.get(month) ?? { sum: 0, days: 0 };
      // Average the rate we will actually store, not its inverse. Averaging
      // yen-per-dollar and then inverting is not the same number, and the one
      // we want is the mean of the conversions we would have applied.
      cell.sum += 1 / perUsd;
      cell.days += 1;
      forCode.set(month, cell);
    }
  }

  const out = new Map<string, Map<string, MonthlyRate>>();
  for (const [code, months] of totals) {
    const forCode = new Map<string, MonthlyRate>();
    for (const [month, cell] of months) {
      forCode.set(month, { rateToUsd: cell.sum / cell.days, days: cell.days });
    }
    out.set(code, forCode);
  }
  return out;
}

/**
 * Fetch every daily quote the provider holds for these currencies.
 *
 * One request covers the whole range — about 7,000 business days back to 1999
 * in half a megabyte — so this is a single call rather than a crawl.
 */
export async function fetchDailyQuotes(
  currencies: string[],
  from = "1999-01-01",
): Promise<Record<string, Record<string, number>>> {
  const symbols = currencies.filter((c) => c.toUpperCase() !== "USD").join(",");
  const url = `${SERIES_URL}/${from}..?base=USD&symbols=${symbols}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`FX provider returned ${res.status}`);

  const body = (await res.json()) as { rates?: Record<string, Record<string, number>> };
  if (!body.rates || Object.keys(body.rates).length === 0) {
    throw new Error("FX provider returned no rates");
  }
  return body.rates;
}
