import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { releasedBefore } from "./release-status";

describe("releasedBefore", () => {
  const now = new Date("2026-09-06T12:00:00Z");

  it("treats a dated release as passed the moment the day is behind us", () => {
    assert.equal(releasedBefore(now).day.toISOString(), now.toISOString());
  });

  it("waits for a month-grained release until the month itself is over", () => {
    // A MONTH date is stored as the 1st and means the whole month. Six figures
    // are dated inside the current month right now; calling them released on
    // the 1st would label them shipped for the whole month they ship in.
    assert.equal(releasedBefore(now).month.toISOString(), "2026-09-01T00:00:00.000Z");
  });

  it("rolls the month cutoff back across a year boundary", () => {
    const january = new Date("2027-01-04T00:00:00Z");
    assert.equal(releasedBefore(january).month.toISOString(), "2027-01-01T00:00:00.000Z");
  });

  it("puts the month cutoff at or before the day cutoff, never after", () => {
    // If this inverted, a month-grained figure would flip earlier than a
    // day-grained one dated identically.
    for (const iso of ["2026-01-01T00:00:00Z", "2026-06-30T23:59:59Z", "2026-12-31T12:00:00Z"]) {
      const c = releasedBefore(new Date(iso));
      assert.ok(c.month.getTime() <= c.day.getTime(), iso);
    }
  });
});
