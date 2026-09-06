import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isFigure,
  parseProductPage,
  productUrl,
  readEnglishTitle,
  readHeightMm,
  readPriceJpy,
  readReleaseMonth,
  readScale,
  readSpecTable,
} from "./alter";

/** The real markup from https://alter-web.jp/products/652/, trimmed. */
const PAGE = `<html><head><title>花火 | ALTER</title></head><body>
<img src="/uploads/products/20260714180744_TL31Qtwu.jpg" alt="">
<table class="tbl-01"><tbody>
  <tr><th>作品名</th><td>崩壊：スターレイル</td></tr>
  <tr><th>Title/Name</th><td>Honkai: Star Rail <br>Sparkle</td></tr>
  <tr><th>発売月</th><td>2027年10月発売<br></td></tr>
  <tr><th>価格</th><td>29,480円（税抜26,800円）<br></td></tr>
</tbody></table>
<table class="tbl-01"><tbody>
  <tr><th>サイズ</th><td>1/7 スケール<br>全高：約230mm</td></tr>
  <tr><th>原 型</th><td>目出ル金<br>原型協力：アルター</td></tr>
</tbody></table>
</body></html>`;

describe("readPriceJpy", () => {
  it("takes the tax-excluded figure, not the one printed first", () => {
    // The rest of the catalogue stores MSRP excluding tax. Taking 29,480 would
    // make every Alter figure look 10% dearer than the Good Smile ones beside
    // it, for no reason a reader could see.
    assert.equal(readPriceJpy("29,480円（税抜26,800円）"), 26800);
  });

  it("uses the only figure when a page states one", () => {
    assert.equal(readPriceJpy("14,800円"), 14800);
  });

  it("gives nothing for a price the maker did not set", () => {
    // "Open price" means the retailer decides. Inventing one here would
    // attribute a shop's number to the manufacturer.
    assert.equal(readPriceJpy("オープン価格"), null);
    assert.equal(readPriceJpy(undefined), null);
  });
});

describe("readReleaseMonth", () => {
  it("reads the month as its first day, in UTC", () => {
    assert.equal(readReleaseMonth("2027年10月発売")?.toISOString(), "2027-10-01T00:00:00.000Z");
  });

  it("handles a single-digit month", () => {
    assert.equal(readReleaseMonth("2024年3月発売")?.toISOString(), "2024-03-01T00:00:00.000Z");
  });

  it("gives nothing when a date is not stated", () => {
    assert.equal(readReleaseMonth("発売時期未定"), null);
  });
});

describe("readScale and readHeightMm", () => {
  it("reads the fraction and the height from one cell", () => {
    assert.equal(readScale("1/7 スケール\n全高：約230mm"), "1/7");
    assert.equal(readHeightMm("1/7 スケール\n全高：約230mm"), 230);
  });

  it("converts centimetres", () => {
    assert.equal(readHeightMm("全高：約23cm"), 230);
  });

  it("gives nothing for a non-scale product", () => {
    assert.equal(readScale("ノンスケール"), null);
  });
});

describe("readEnglishTitle", () => {
  it("splits the series from the character", () => {
    assert.deepEqual(readEnglishTitle("Honkai: Star Rail \nSparkle"), {
      series: "Honkai: Star Rail",
      name: "Sparkle",
    });
  });

  it("treats a single line as the series, which is the half never omitted", () => {
    assert.deepEqual(readEnglishTitle("Fate/Grand Order"), {
      series: "Fate/Grand Order",
      name: null,
    });
  });
});

describe("readSpecTable", () => {
  it("collects rows from both tables on the page", () => {
    const spec = readSpecTable(PAGE);
    assert.equal(spec.get("作品名"), "崩壊：スターレイル");
    assert.equal(spec.get("サイズ"), "1/7 スケール\n全高：約230mm");
  });

  it("squeezes the stray spaces out of a label", () => {
    // The markup writes "原 型" with a space inside it.
    assert.equal(readSpecTable(PAGE).get("原型"), "目出ル金\n原型協力：アルター");
  });
});

describe("parseProductPage", () => {
  const p = parseProductPage(PAGE, "https://alter-web.jp/products/652/")!;

  it("prefers the English name and keeps the Japanese one", () => {
    assert.equal(p.name, "Sparkle");
    assert.equal(p.nameJa, "花火");
  });

  it("reads the id, series, price, date and size together", () => {
    assert.equal(p.productId, "652");
    assert.equal(p.seriesEn, "Honkai: Star Rail");
    assert.equal(p.seriesJa, "崩壊：スターレイル");
    assert.equal(p.msrpAmount, 26800);
    assert.equal(p.releaseDate?.toISOString(), "2027-10-01T00:00:00.000Z");
    assert.equal(p.scale, "1/7");
    assert.equal(p.heightMm, 230);
  });

  it("takes the first product image, absolute", () => {
    assert.equal(p.imageUrl, "https://alter-web.jp/uploads/products/20260714180744_TL31Qtwu.jpg");
  });

  it("gives no name at all when they state no English one", () => {
    // The row is empty on older products. Falling back to the Japanese name
    // would add figures nobody reading this site can search for and no English
    // marketplace title can match; the importer skips these instead.
    const jaOnly = parseProductPage(
      PAGE.replace("Honkai: Star Rail <br>Sparkle", "Honkai: Star Rail"),
      "https://alter-web.jp/products/1/",
    )!;
    assert.equal(jaOnly.name, null);
    assert.equal(jaOnly.nameJa, "花火");
    assert.equal(jaOnly.seriesEn, "Honkai: Star Rail");
  });

  it("returns nothing for a page with no product on it", () => {
    // A missing id still renders the site chrome, so the table is what says a
    // product is really here.
    assert.equal(parseProductPage("<html><title>404 Not Found | ALTER</title></html>", "https://alter-web.jp/products/700/"), null);
  });
});

describe("isFigure", () => {
  const base = parseProductPage(PAGE, "https://alter-web.jp/products/652/")!;

  it("accepts a painted scale figure", () => {
    assert.equal(isFigure(base), true);
  });

  it("refuses a kit, which states no scale and is not what this catalogues", () => {
    assert.equal(isFigure({ ...base, name: "Some Model Kit", scale: null, heightMm: null }), false);
  });

  it("accepts a non-scale figure that states a height", () => {
    assert.equal(isFigure({ ...base, scale: null, heightMm: 180 }), true);
  });
});

describe("productUrl", () => {
  it("builds the walked url", () => {
    assert.equal(productUrl(652), "https://alter-web.jp/products/652/");
  });
});
