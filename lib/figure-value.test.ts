import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dayValue,
  figureValue,
  portfolioBasis,
  sumValues,
  valueLabel,
  valueNote,
} from "./figure-value";

describe("figureValue", () => {
  it("prefers a sold price, which is a record rather than a hope", () => {
    const v = figureValue({ marketValueUsd: 120, askMedianUsd: 150, askListings: 9 })!;
    assert.equal(v.basis, "sold");
    assert.equal(v.amountUsd, 120);
  });

  it("falls back to the asking median, carrying its sample size", () => {
    const v = figureValue({ marketValueUsd: null, askMedianUsd: 150, askListings: 9 })!;
    assert.equal(v.basis, "asking");
    assert.equal(v.amountUsd, 150);
    assert.equal(v.listings, 9);
  });

  it("returns nothing when there is neither", () => {
    assert.equal(figureValue({ marketValueUsd: null, askMedianUsd: null }), null);
  });
});

describe("valueLabel and valueNote", () => {
  it("labels an asking price as one", () => {
    assert.equal(valueLabel("asking"), "Typical asking price");
    assert.equal(valueLabel("sold"), "Market value");
  });

  it("shows what an asking price rests on, and pluralises it", () => {
    assert.equal(valueNote({ amountUsd: 1, basis: "asking", listings: 9 }), "median of 9 listings");
    assert.equal(valueNote({ amountUsd: 1, basis: "asking", listings: 1 }), "median of 1 listing");
  });

  it("adds no note to a sold price, which needs no caveat", () => {
    assert.equal(valueNote({ amountUsd: 1, basis: "sold", listings: 0 }), null);
  });
});

describe("sumValues", () => {
  const rows = [
    { quantity: 2, figure: { marketValueUsd: null, askMedianUsd: 50, askListings: 4 } },
    { quantity: 1, figure: { marketValueUsd: 100, askMedianUsd: null, askListings: 0 } },
    { quantity: 3, figure: { marketValueUsd: null, askMedianUsd: null } },
  ];

  it("multiplies by quantity and reports what the total is made of", () => {
    const v = sumValues(rows);
    assert.equal(v.totalUsd, 200);
    assert.equal(v.fromAsking, 2);
    assert.equal(v.fromSold, 1);
    assert.equal(v.unvalued, 3);
  });

  it("counts unvalued items rather than silently treating them as zero", () => {
    // A collection page that shows a total without saying three items are
    // missing from it is understating and not saying so.
    assert.equal(sumValues(rows).unvalued, 3);
  });

  it("handles an empty collection", () => {
    assert.deepEqual(sumValues([]), { totalUsd: 0, fromSold: 0, fromAsking: 0, unvalued: 0 });
  });
});

describe("portfolioBasis", () => {
  it("describes a total by what most of it rests on", () => {
    assert.equal(portfolioBasis({ totalUsd: 1, fromSold: 1, fromAsking: 9, unvalued: 0 }), "asking");
    assert.equal(portfolioBasis({ totalUsd: 1, fromSold: 9, fromAsking: 1, unvalued: 0 }), "sold");
  });

  it("says nothing about a total with nothing in it", () => {
    assert.equal(portfolioBasis({ totalUsd: 0, fromSold: 0, fromAsking: 0, unvalued: 4 }), null);
  });
});

describe("dayValue", () => {
  const empty = {
    medianUsd: null, minUsd: null, maxUsd: null, sampleSize: null,
    askMedianUsd: null, askMinUsd: null, askMaxUsd: null, askCount: null,
  };

  it("prefers a sold price when the day has one", () => {
    assert.deepEqual(
      dayValue({ ...empty, medianUsd: "210", minUsd: "180", maxUsd: "340", sampleSize: 6,
                 askMedianUsd: "260", askMinUsd: "200", askMaxUsd: "500", askCount: 12 }),
      { median: 210, min: 180, max: 340, volume: 6, basis: "sold" },
    );
  });

  it("falls back to the asking spread", () => {
    assert.deepEqual(
      dayValue({ ...empty, askMedianUsd: "65", askMinUsd: "25", askMaxUsd: "306.5", askCount: 50 }),
      { median: 65, min: 25, max: 306.5, volume: 50, basis: "asking" },
    );
  });

  it("drops a day with neither rather than plotting a zero", () => {
    assert.equal(dayValue(empty), null);
  });

  it("keeps an asking point whose range is unknown", () => {
    assert.deepEqual(dayValue({ ...empty, askMedianUsd: "40", askCount: 3 }), {
      median: 40, min: null, max: null, volume: 3, basis: "asking",
    });
  });

  it("reports a missing count as zero rather than crashing", () => {
    assert.deepEqual(dayValue({ ...empty, askMedianUsd: "40" }), {
      median: 40, min: null, max: null, volume: 0, basis: "asking",
    });
  });

  it("does not treat a zero sold median as absent", () => {
    // A figure that genuinely sold for nothing is nonsense, but the guard here
    // must be "is it null", not "is it falsy" — the second silently reclassifies
    // the point as an asking price and mislabels it.
    const v = dayValue({ ...empty, medianUsd: "0", sampleSize: 1, askMedianUsd: "50", askCount: 9 });
    assert.equal(v?.basis, "sold");
    assert.equal(v?.median, 0);
  });
});
