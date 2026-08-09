import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LIMITS,
  checkRateLimit,
  screenReportedSale,
  validateReport,
  type Reference,
} from "./validate";

/**
 * These tests guard the line between "goes live instantly" and "a human looks
 * first". Getting it wrong in one direction makes reporting useless; in the
 * other it lets one person move a published market value.
 */

const NOW = new Date("2026-08-09T12:00:00Z");

const salesRef = (medianUsd: number, sampleSize = 10): Reference => ({
  kind: "sales",
  medianUsd,
  sampleSize,
});

describe("screenReportedSale — with prior sales", () => {
  it("approves a price near the median", () => {
    assert.equal(screenReportedSale(250, salesRef(240)).status, "APPROVED");
  });

  it("approves across the whole plausible band", () => {
    for (const price of [61, 100, 240, 500, 959]) {
      assert.equal(
        screenReportedSale(price, salesRef(240)).status,
        "APPROVED",
        `${price} should be inside the band around 240`,
      );
    }
  });

  it("holds a suspiciously high report", () => {
    const result = screenReportedSale(2400, salesRef(240));
    assert.equal(result.status, "PENDING_REVIEW");
    assert.match(result.flagReason ?? "", /far above/);
  });

  it("holds a suspiciously low report", () => {
    const result = screenReportedSale(10, salesRef(240));
    assert.equal(result.status, "PENDING_REVIEW");
    assert.match(result.flagReason ?? "", /far below/);
  });

  it("ignores a median built on too few sales", () => {
    // Two prior sales isn't a trustworthy yardstick, so this falls through to
    // the no-reference rule and is approved on the ceiling instead.
    const result = screenReportedSale(1800, salesRef(240, 2));
    assert.equal(result.status, "APPROVED");
  });

  it("still holds an extreme report when the median is weak", () => {
    const result = screenReportedSale(9000, salesRef(240, 2));
    assert.equal(result.status, "PENDING_REVIEW");
  });
});

describe("screenReportedSale — with only MSRP", () => {
  const msrp: Reference = { kind: "msrp", usd: 150 };

  it("allows a big premium over retail, because grails do that", () => {
    assert.equal(screenReportedSale(1400, msrp).status, "APPROVED");
  });

  it("allows a discount below retail", () => {
    assert.equal(screenReportedSale(40, msrp).status, "APPROVED");
  });

  it("holds an order-of-magnitude mistake", () => {
    // Someone typed a yen figure into the dollar box.
    const result = screenReportedSale(22000, msrp);
    assert.equal(result.status, "PENDING_REVIEW");
    assert.match(result.flagReason ?? "", /retail price/);
  });
});

describe("screenReportedSale — with no reference at all", () => {
  const none: Reference = { kind: "none" };

  it("approves ordinary prices", () => {
    assert.equal(screenReportedSale(180, none).status, "APPROVED");
  });

  it("holds anything above the ceiling", () => {
    const result = screenReportedSale(LIMITS.noReferenceCeilingUsd + 1, none);
    assert.equal(result.status, "PENDING_REVIEW");
  });

  it("treats the ceiling itself as acceptable", () => {
    assert.equal(screenReportedSale(LIMITS.noReferenceCeilingUsd, none).status, "APPROVED");
  });
});

describe("validateReport", () => {
  const ok = { amountUsd: 200, soldAt: new Date("2026-07-01T00:00:00Z") };

  it("accepts a well-formed report", () => {
    assert.equal(validateReport(ok, NOW), null);
  });

  it("rejects zero and negative prices", () => {
    assert.equal(validateReport({ ...ok, amountUsd: 0 }, NOW)?.field, "amount");
    assert.equal(validateReport({ ...ok, amountUsd: -50 }, NOW)?.field, "amount");
  });

  it("rejects NaN", () => {
    assert.equal(validateReport({ ...ok, amountUsd: Number.NaN }, NOW)?.field, "amount");
  });

  it("rejects absurd prices outright rather than queuing them", () => {
    assert.equal(validateReport({ ...ok, amountUsd: 500_000 }, NOW)?.field, "amount");
  });

  it("rejects future sale dates", () => {
    const future = new Date("2026-09-01T00:00:00Z");
    assert.equal(validateReport({ ...ok, soldAt: future }, NOW)?.field, "soldAt");
  });

  it("tolerates a sale dated slightly ahead, for timezones", () => {
    const justAhead = new Date(NOW.getTime() + 6 * 3600_000);
    assert.equal(validateReport({ ...ok, soldAt: justAhead }, NOW), null);
  });

  it("rejects sales too old to be relevant", () => {
    const ancient = new Date("2010-01-01T00:00:00Z");
    assert.equal(validateReport({ ...ok, soldAt: ancient }, NOW)?.field, "soldAt");
  });

  it("rejects an unparseable date", () => {
    assert.equal(validateReport({ ...ok, soldAt: new Date("nonsense") }, NOW)?.field, "soldAt");
  });
});

describe("checkRateLimit", () => {
  it("allows a normal user", () => {
    assert.equal(checkRateLimit({ reportsToday: 3, reportsTodayForFigure: 1 }), null);
  });

  it("blocks once the daily total is reached", () => {
    const reason = checkRateLimit({
      reportsToday: LIMITS.maxPerUserPerDay,
      reportsTodayForFigure: 0,
    });
    assert.match(reason ?? "", /daily limit/);
  });

  it("blocks repeated reports on one figure even when under the daily total", () => {
    const reason = checkRateLimit({
      reportsToday: 5,
      reportsTodayForFigure: LIMITS.maxPerFigurePerUserPerDay,
    });
    assert.match(reason ?? "", /this figure/);
  });
});
