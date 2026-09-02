import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fieldsToFill } from "./enrich";

describe("fieldsToFill", () => {
  it("fills a column that is empty", () => {
    assert.deepEqual(fieldsToFill({ heightMm: null }, { heightMm: 230 }), { heightMm: 230 });
  });

  it("leaves a column that already has a value", () => {
    // A shop's figure is not better than ours, and shops round heights.
    assert.deepEqual(fieldsToFill({ heightMm: 230 }, { heightMm: 225 }), {});
  });

  it("refuses a locked field even when the column is empty", () => {
    // A lock is somebody having read the box. An import must not undo that.
    assert.deepEqual(fieldsToFill({ scale: null }, { scale: "1/7" }, ["scale"]), {});
  });

  it("knows the lock names are the form's, not the column's", () => {
    assert.deepEqual(fieldsToFill({ msrpAmount: null }, { msrpAmount: 16093, msrpCurrency: "JPY" }, ["msrp"]), {});
    assert.deepEqual(fieldsToFill({ manufacturerId: null }, { manufacturerId: "m1" }, ["manufacturer"]), {});
  });

  it("ignores anything the shop did not state", () => {
    assert.deepEqual(fieldsToFill({ scale: null, heightMm: null }, { scale: null, heightMm: undefined }), {});
    assert.deepEqual(fieldsToFill({ nameJa: null }, { nameJa: "" }), {});
  });

  it("will not write half a price", () => {
    // Two columns, one fact. An amount with no currency is a number in an
    // unknown unit, which is worse than no number.
    assert.deepEqual(fieldsToFill({ msrpAmount: null, msrpCurrency: null }, { msrpAmount: 16093 }), {});
    assert.deepEqual(fieldsToFill({ msrpAmount: 100, msrpCurrency: null }, { msrpCurrency: "JPY" }), {});
  });

  it("writes both halves together", () => {
    assert.deepEqual(
      fieldsToFill({ msrpAmount: null, msrpCurrency: null }, { msrpAmount: 16093, msrpCurrency: "JPY" }),
      { msrpAmount: 16093, msrpCurrency: "JPY" },
    );
  });

  it("fills several at once and reports only those", () => {
    assert.deepEqual(
      fieldsToFill(
        { scale: "1/7", heightMm: null, seriesId: null },
        { scale: "1/8", heightMm: 230, seriesId: "s1" },
      ),
      { heightMm: 230, seriesId: "s1" },
    );
  });
});
