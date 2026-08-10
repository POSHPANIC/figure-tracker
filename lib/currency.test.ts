import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_CURRENCY,
  SUPPORTED_CURRENCIES,
  USD_MONEY,
  approx,
  formatMoney,
  isConverted,
  isSupportedCurrency,
  type DisplayMoney,
} from "./currency";

/**
 * Conversion is where a price site quietly lies to people. The cases below are
 * the ones that matter: not losing precision on a number the user typed
 * themselves, and never inventing a figure when we have no rate.
 */

// ~152 yen to the dollar.
const JPY: DisplayMoney = { currency: "JPY", usdToDisplay: 151.5 };
const EUR: DisplayMoney = { currency: "EUR", usdToDisplay: 0.92 };

describe("formatMoney", () => {
  it("passes USD through untouched", () => {
    assert.equal(formatMoney(249.75, USD_MONEY), "$249.75");
  });

  it("converts to the display currency", () => {
    // 100 USD * 0.92 = 92 EUR
    assert.equal(formatMoney(100, EUR), "€92.00");
  });

  it("drops the minor unit for yen", () => {
    // Yen has no subunit — "¥15,150.00" would be wrong, not just ugly.
    assert.equal(formatMoney(100, JPY), "¥15,150");
  });

  it("returns a dash rather than zero for a missing value", () => {
    assert.equal(formatMoney(null, EUR), "—");
    assert.equal(formatMoney(undefined, JPY), "—");
  });

  it("accepts Prisma Decimal-like values", () => {
    assert.equal(formatMoney({ toString: () => "249.75" }, USD_MONEY), "$249.75");
  });

  it("formats compactly when asked", () => {
    // Chart axes can't fit "$1,200.00" at every tick.
    assert.match(formatMoney(1200, USD_MONEY, { compact: true }), /1\.2K/);
  });
});

describe("formatMoney with an original amount", () => {
  it("shows the original when it's already in the display currency", () => {
    // The user typed 25000. Round-tripping through USD gives ¥24,997, which
    // reads as a bug to the person who entered it.
    const shown = formatMoney(158.3, JPY, {
      original: { amount: 25000, currency: "JPY" },
    });
    assert.equal(shown, "¥25,000");
  });

  it("converts when the original is a different currency", () => {
    const shown = formatMoney(100, EUR, { original: { amount: 15150, currency: "JPY" } });
    assert.equal(shown, "€92.00");
  });

  it("is case-insensitive about the currency code", () => {
    const shown = formatMoney(158.3, JPY, { original: { amount: 25000, currency: "jpy" } });
    assert.equal(shown, "¥25,000");
  });

  it("falls back to conversion when the original has no currency", () => {
    const shown = formatMoney(100, EUR, { original: { amount: 92, currency: null } });
    assert.equal(shown, "€92.00");
  });

  it("falls back to conversion when the original amount is unusable", () => {
    const shown = formatMoney(100, EUR, { original: { amount: null, currency: "EUR" } });
    assert.equal(shown, "€92.00");
  });
});

describe("isConverted", () => {
  it("is false when the source is already the display currency", () => {
    assert.equal(isConverted(JPY, "JPY"), false);
    assert.equal(isConverted(USD_MONEY, "USD"), false);
  });

  it("is true when a conversion happened", () => {
    assert.equal(isConverted(EUR, "JPY"), true);
    assert.equal(isConverted(JPY, "USD"), true);
  });

  it("treats a USD-only aggregate as converted unless showing USD", () => {
    // Snapshots carry no source currency — they're USD by construction.
    assert.equal(isConverted(USD_MONEY, null), false);
    assert.equal(isConverted(EUR, null), true);
  });
});

describe("supported currencies", () => {
  it("accepts every advertised code", () => {
    for (const c of SUPPORTED_CURRENCIES) {
      assert.equal(isSupportedCurrency(c.code), true, c.code);
    }
  });

  it("rejects anything else, including junk from a cookie", () => {
    for (const bad of ["", "usd", "XYZ", "'; DROP TABLE", undefined, null]) {
      assert.equal(isSupportedCurrency(bad as string), false, String(bad));
    }
  });

  it("defaults to a currency it actually supports", () => {
    assert.equal(isSupportedCurrency(DEFAULT_CURRENCY), true);
  });

  it("formats correctly in every supported currency", () => {
    // Guards against adding a code that Intl can't format, which would throw
    // on a page render rather than fail here.
    for (const c of SUPPORTED_CURRENCIES) {
      const out = formatMoney(100, { currency: c.code, usdToDisplay: 1 });
      assert.ok(out.length > 0 && out !== "—", `${c.code} produced "${out}"`);
    }
  });
});

describe("approx", () => {
  it("marks a converted figure as approximate", () => {
    assert.equal(approx("€133.00"), "≈ €133.00");
  });
});
