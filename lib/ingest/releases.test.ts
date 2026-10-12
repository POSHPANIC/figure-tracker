import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseShopVariants } from "./goodsmile-shop";
import { hasShipped, isSeparatePrinting, printings, upcomingReissue, type Printing } from "./releases";

/** The shape of goodsmile.com/en/product/1633, trimmed to the fields read. */
const BRS = `<script>
        let variantItems = [{"id":390,"label":"Rerelease","fullyQualifiedProductName":"Rerelease [Insane Black Rock Shooter]","type":"resale","jan":"4580590199484","retailPriceInTax":20000,"preOrderStartDate":"2024-07-18T03:00:08.000000Z","preOrderEndDate":"2024-08-28T14:59:59.000000Z","releaseDate":"2025-03-17T15:00:00.000000Z","description":"weapons [brackets] in \\"quotes\\"","productMasterCode":"1633R1"},{"id":1633,"label":"","fullyQualifiedProductName":"Insane Black Rock Shooter","type":"original","jan":"4582191965932","retailPriceInTax":14457,"preOrderStartDate":"2012-12-26T03:00:00.000000Z","preOrderEndDate":"2013-02-06T14:59:59.000000Z","releaseDate":"2013-09-17T15:00:00.000000Z","productMasterCode":"1633"}];
        let other = [1];
</script>`;

const row = (over: Partial<Printing>): Printing => ({
  kind: "reissue",
  label: null,
  releaseDate: null,
  releaseDatePrecision: "MONTH",
  priceAmount: null,
  priceCurrency: null,
  ...over,
});

describe("parseShopVariants", () => {
  it("reads every printing on the page, each with its own barcode", () => {
    const [re, og] = parseShopVariants(BRS);
    assert.equal(re.code, "1633R1");
    assert.equal(re.kind, "reissue");
    assert.equal(re.label, "Rerelease");
    assert.equal(re.jan, "4580590199484");
    assert.equal(re.priceJpy, 20000);
    assert.equal(re.releaseMonth?.toISOString(), "2025-03-01T00:00:00.000Z");
    assert.equal(re.preorderClosesAt?.toISOString(), "2024-08-28T14:59:59.000Z");
    assert.equal(og.kind, "original");
    assert.equal(og.label, null);
    assert.equal(og.jan, "4582191965932");
  });

  it("takes the ship month as Japan has it", () => {
    // 15:00 UTC on the 31st is the 1st of the next month in Tokyo.
    const html = BRS.replace("2025-03-17T15:00:00", "2025-03-31T15:00:00");
    assert.equal(parseShopVariants(html)[0].releaseMonth?.toISOString(), "2025-04-01T00:00:00.000Z");
  });

  it("finds nothing on a page with one printing, or none at all", () => {
    assert.deepEqual(parseShopVariants("<script>let variantItems = [];</script>"), []);
    assert.deepEqual(parseShopVariants("<html></html>"), []);
  });
});

describe("upcomingReissue", () => {
  const now = new Date("2026-10-12T00:00:00Z");

  it("is the reissue that has not shipped", () => {
    const shipped = row({ releaseDate: "2025-03-01T00:00:00Z" });
    const coming = row({ releaseDate: "2027-03-01T00:00:00Z" });
    assert.equal(upcomingReissue([shipped, coming], now), coming);
    assert.equal(upcomingReissue([shipped], now), null);
  });

  it("counts this month as not yet shipped, for a month-dated reissue", () => {
    assert.ok(upcomingReissue([row({ releaseDate: "2026-10-01T00:00:00Z" })], now));
  });

  it("never treats the original printing as upcoming", () => {
    assert.equal(upcomingReissue([row({ kind: "original", releaseDate: "2027-01-01T00:00:00Z" })], now), null);
  });

  it("counts an undated reissue only while its orders are open or ahead", () => {
    assert.ok(upcomingReissue([row({ preorderClosesAt: "2026-11-01T00:00:00Z" })], now));
    assert.equal(upcomingReissue([row({ preorderClosesAt: "2024-01-01T00:00:00Z" })], now), null);
    assert.equal(upcomingReissue([row({})], now), null);
  });
});

describe("printings", () => {
  const own: Printing = row({
    kind: "original",
    releaseDate: "2013-09-15T00:00:00Z",
    priceAmount: "14457",
    priceCurrency: "JPY",
    jan: "4580590199484",
  });

  it("folds the source's original into the figure's own printing", () => {
    const list = printings(own, [
      row({ kind: "original", releaseDate: "2013-09-01T00:00:00Z", preorderOpensAt: "2012-12-26T03:00:00Z", jan: "4582191965932" }),
      row({ label: "Rerelease", releaseDate: "2025-03-01T00:00:00Z", priceAmount: "20000", priceCurrency: "JPY" }),
    ]);
    assert.equal(list.length, 2);
    assert.equal(list[0].label, "Original");
    assert.equal(list[0].preorderOpensAt, "2012-12-26T03:00:00Z");
    // The printing's own barcode, not the one the figure happened to be found by.
    assert.equal(list[0].jan, "4582191965932");
    assert.equal(list[1].label, "Rerelease");
    assert.deepEqual(list.map((p) => p.own), [true, false]);
  });

  it("calls an older folded entry the original and the figure's own the reissue", () => {
    const list = printings(own, [row({ releaseDate: "2010-02-01T00:00:00Z" })]);
    assert.equal(list[0].releaseDate, "2010-02-01T00:00:00Z");
    assert.equal(list[0].label, "Original");
    assert.equal(list[1].label, "Reissue");
  });

  it("is just the figure when there is nothing else", () => {
    assert.equal(printings(own, []).length, 1);
  });
});

describe("hasShipped", () => {
  it("reads the precision the date was given in", () => {
    const now = new Date("2026-10-12T00:00:00Z");
    assert.equal(hasShipped({ releaseDate: "2026-10-01T00:00:00Z", releaseDatePrecision: "MONTH" }, now), false);
    assert.equal(hasShipped({ releaseDate: "2026-10-01T00:00:00Z", releaseDatePrecision: "DAY" }, now), true);
  });
});

describe("isSeparatePrinting", () => {
  it("tells a reissue from one printing imported twice", () => {
    assert.equal(isSeparatePrinting("2025-06-01T00:00:00Z", "2027-06-01T00:00:00Z"), true);
    assert.equal(isSeparatePrinting("2027-05-31T00:00:00Z", "2027-06-15T00:00:00Z"), false);
    assert.equal(isSeparatePrinting(null, "2027-06-15T00:00:00Z"), false);
  });
});
