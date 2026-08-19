import { prisma } from "../prisma";
import { monthKey, type MonthlyRate } from "./fx-monthly";

/**
 * Currency conversion.
 *
 * Rates are cached in the FxRate table one row per currency per day. That makes
 * historical prices reproducible: a listing ingested in March keeps the March
 * rate forever instead of silently re-valuing itself every time yen moves.
 *
 * Source is open.er-api.com, which needs no API key. If it's unreachable we
 * fall back to the most recent rate we already stored, and only fail if we've
 * never seen the currency at all.
 */

const RATES_URL = "https://open.er-api.com/v6/latest/USD";

/** Midnight UTC today. */
function today(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

let memoized: { date: string; rates: Map<string, number> } | null = null;

async function fetchRates(): Promise<Map<string, number>> {
  const res = await fetch(RATES_URL, { next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`FX provider returned ${res.status}`);

  const body = (await res.json()) as { result: string; rates: Record<string, number> };
  if (body.result !== "success") throw new Error("FX provider returned a non-success result");

  // The API gives USD -> X. We store X -> USD, which is what callers need.
  const out = new Map<string, number>();
  for (const [code, perUsd] of Object.entries(body.rates)) {
    if (perUsd > 0) out.set(code.toUpperCase(), 1 / perUsd);
  }
  return out;
}

/** Load today's rates, persisting them so historical conversions stay stable. */
export async function loadRates(): Promise<Map<string, number>> {
  const date = today();
  const key = date.toISOString().slice(0, 10);
  if (memoized?.date === key) return memoized.rates;

  const cached = await prisma.fxRate.findMany({ where: { date } });
  if (cached.length > 0) {
    const rates = new Map(cached.map((r) => [r.currency, Number(r.rateToUsd)]));
    memoized = { date: key, rates };
    return rates;
  }

  let rates: Map<string, number>;
  try {
    rates = await fetchRates();
    await prisma.fxRate.createMany({
      data: [...rates].map(([currency, rateToUsd]) => ({ currency, date, rateToUsd })),
      skipDuplicates: true,
    });
  } catch (err) {
    console.warn("[fx] live rates unavailable, falling back to last known:", err);
    const latest = await prisma.fxRate.findMany({
      orderBy: { date: "desc" },
      take: 200,
      distinct: ["currency"],
    });
    rates = new Map(latest.map((r) => [r.currency, Number(r.rateToUsd)]));
  }

  memoized = { date: key, rates };
  return rates;
}

export type Converted = { amountUsd: number; fxRate: number };

/**
 * Convert to USD. Throws for unknown currencies rather than guessing — a wrong
 * rate silently corrupts the price history, which is the whole product.
 */
export async function toUsd(amount: number, currency: string): Promise<Converted> {
  const code = currency.toUpperCase();
  if (code === "USD") return { amountUsd: round2(amount), fxRate: 1 };

  const rates = await loadRates();
  const rate = rates.get(code);
  if (!rate) throw new Error(`No FX rate available for ${code}`);

  return { amountUsd: round2(amount * rate), fxRate: rate };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Monthly rates, for prices that were set in the past.
//
// The daily table above answers "what is this worth now". A figure's MSRP is a
// different question — what the manufacturer charged, in a month that has
// already happened — and today's rate answers it wrongly. See fx-monthly.ts.
// ---------------------------------------------------------------------------

let monthly: Map<string, MonthlyRate> | null = null;

/**
 * Every monthly rate we hold, keyed "JPY:2016-03".
 *
 * Loaded once per process and never invalidated: a past month's average is
 * settled once the month has passed, and the table only gains rows.
 */
export async function loadMonthlyRates(): Promise<Map<string, MonthlyRate>> {
  if (monthly) return monthly;

  const rows = await prisma.fxMonthly.findMany({
    select: { currency: true, month: true, rateToUsd: true, days: true },
  });

  const out = new Map<string, MonthlyRate>();
  for (const row of rows) {
    out.set(`${row.currency}:${monthKey(row.month)}`, {
      rateToUsd: Number(row.rateToUsd),
      days: row.days,
    });
  }
  monthly = out;
  return out;
}

/** Drop the cache, for the backfill script which writes and then reads back. */
export function forgetMonthlyRates(): void {
  monthly = null;
}

/**
 * The rate for one currency in the month containing `when`.
 *
 * Null when we hold nothing for that month — a figure due next year, or a
 * currency the provider does not carry. Callers fall back to today's rate and
 * say so on the page, rather than invent a number for a month that has not
 * happened.
 */
export async function monthlyRateToUsd(currency: string, when: Date): Promise<number | null> {
  const code = currency.toUpperCase();
  if (code === "USD") return 1;

  const rates = await loadMonthlyRates();
  const found = rates.get(`${code}:${monthKey(when)}`);
  return found && found.rateToUsd > 0 ? found.rateToUsd : null;
}
