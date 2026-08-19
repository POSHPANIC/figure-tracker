import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { averageByMonth, monthKey, monthStart } from "./fx-monthly";

describe("monthStart / monthKey", () => {
  it("collapses any day to the first of its month, in UTC", () => {
    assert.equal(monthStart(new Date("2016-03-15T00:00:00Z")).toISOString(), "2016-03-01T00:00:00.000Z");
    assert.equal(monthStart(new Date("2016-03-31T23:59:59Z")).toISOString(), "2016-03-01T00:00:00.000Z");
    assert.equal(monthKey(new Date("2016-03-15T00:00:00Z")), "2016-03");
  });
});

describe("averageByMonth", () => {
  it("stores the multiplier to USD, not the provider's units-per-USD", () => {
    const out = averageByMonth({ "2016-03-01": { JPY: 100 } });
    assert.equal(out.get("JPY")!.get("2016-03")!.rateToUsd, 1 / 100);
  });

  it("averages the conversions, not the quotes", () => {
    // 1/100 and 1/200 average to 0.0075. Averaging the quotes first gives 150,
    // whose inverse is 0.00667 — a different number, and not the mean of the
    // conversions we would have applied.
    const out = averageByMonth({
      "2016-03-01": { JPY: 100 },
      "2016-03-02": { JPY: 200 },
    });
    assert.equal(out.get("JPY")!.get("2016-03")!.rateToUsd, 0.0075);
  });

  it("keeps months apart and counts the days behind each", () => {
    const out = averageByMonth({
      "2016-03-30": { JPY: 100 },
      "2016-03-31": { JPY: 100 },
      "2016-04-01": { JPY: 50 },
    });
    const jpy = out.get("JPY")!;
    assert.equal(jpy.get("2016-03")!.days, 2);
    assert.equal(jpy.get("2016-04")!.days, 1);
    assert.equal(jpy.get("2016-04")!.rateToUsd, 1 / 50);
  });

  it("handles several currencies in one pass", () => {
    const out = averageByMonth({ "2016-03-01": { JPY: 100, EUR: 0.5 } });
    assert.equal(out.get("EUR")!.get("2016-03")!.rateToUsd, 2);
    assert.equal(out.get("JPY")!.get("2016-03")!.rateToUsd, 0.01);
  });

  it("ignores quotes that would zero or invert a price", () => {
    // A zero or negative rate silently destroys every price it touches, so it
    // must never reach the table.
    const out = averageByMonth({
      "2016-03-01": { JPY: 0, EUR: -1 },
      "2016-03-02": { JPY: 100 },
    });
    assert.equal(out.get("JPY")!.get("2016-03")!.days, 1);
    assert.equal(out.has("EUR"), false);
  });

  it("returns nothing for an empty series rather than throwing", () => {
    assert.equal(averageByMonth({}).size, 0);
  });
});
