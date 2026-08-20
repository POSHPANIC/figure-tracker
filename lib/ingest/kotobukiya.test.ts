import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  categoryFor,
  classify,
  parseHeightMm,
  parseSalesMonth,
  parseScale,
  parseSpecs,
  statusFor,
} from "./kotobukiya";

/** Trimmed from the live page for PV428, the Van Arkride scale figure. */
const PAGE = `
  <h1>Van Arkride</h1>
  <div class="product-info__block product-info__block--sm">
    Release : <span class="product-info__salesMonth">April 2027</span>
  </div>
  <dl class="ktb-product-specifications">
    <div class="ktb-product-specifications__item">
      <dt class="ktb-product-specifications__term">Series</dt>
      <dd class="ktb-product-specifications__description">
        <a href="/collections/all?filter.p.m.ktb.series=The+Legend+of+Heroes" class="x">The Legend of Heroes</a>
      </dd>
    </div>
    <div class="ktb-product-specifications__item">
      <dt class="ktb-product-specifications__term">Manufacturer</dt>
      <dd class="ktb-product-specifications__description"><a href="#">KOTOBUKIYA</a></dd>
    </div>
    <div class="ktb-product-specifications__item">
      <dt class="ktb-product-specifications__term">Specifications</dt>
      <dd class="ktb-product-specifications__description"><a href="#">Pre-Painted Figure</a></dd>
    </div>
    <div class="ktb-product-specifications__item">
      <dt class="ktb-product-specifications__term">Scale</dt>
      <dd class="ktb-product-specifications__description">1/8</dd>
    </div>
    <div class="ktb-product-specifications__item">
      <dt class="ktb-product-specifications__term">Size</dt>
      <dd class="ktb-product-specifications__description">225mm tall</dd>
    </div>
    <div class="ktb-product-specifications__item">
      <dt class="ktb-product-specifications__term">SKU</dt>
      <dd class="ktb-product-specifications__description">PV428</dd>
    </div>
  </dl>
`;

const FIGURE = {
  id: 10305093730617,
  title: "Van Arkride",
  handle: "190526075535",
  product_type: "Figure",
  tags: ["cat_figure", "cat_scale-figure", "Pre-order_1"],
  updated_at: "2026-08-01T00:00:00Z",
  images: [{ src: "https://cdn.shopify.com/a.jpg" }, { src: "https://cdn.shopify.com/b.jpg" }],
  variants: [{ sku: "PV428", price: "229.99", available: true }],
};

describe("classify", () => {
  it("accepts a figure and carries the parts we store", () => {
    const v = classify(FIGURE);
    assert.equal(v.ok, true);
    if (!v.ok) return;
    assert.equal(v.candidate.sku, "PV428");
    assert.equal(v.candidate.priceUsd, 229.99);
    assert.equal(v.candidate.url, "https://kotobukiya-us.com/products/190526075535");
    assert.equal(v.candidate.imageUrls.length, 2);
  });

  it("refuses bonus items, which are listed as products with no price", () => {
    // A cardboard illustration board that ships with a preorder. It has a
    // product page and images; importing it would invent a figure.
    const bonus = {
      ...FIGURE,
      title: "Van Arkride Illustration Board",
      tags: ["Bonus Item", "Pre-order_1"],
      variants: [{ sku: "TZ655", price: "0.00", available: true }],
    };
    const v = classify(bonus);
    assert.equal(v.ok, false);
    if (v.ok) return;
    assert.equal(v.reason, "bonus item");
  });

  it("names a bonus item as one even when it carries no product_type", () => {
    // 117 of their 165 bonus entries have no type at all. Reporting those as
    // "no product_type" reads like a gap in their data rather than what it is.
    const v = classify({ ...FIGURE, product_type: "", tags: ["Bonus Item", "Released"] });
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.reason, "bonus item");
  });

  it("refuses a zero price even without the tag", () => {
    const free = { ...FIGURE, tags: ["cat_figure"], variants: [{ sku: "X", price: "0.00" }] };
    const v = classify(free);
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.reason, "no price");
  });

  it("refuses model kits, which are most of the store", () => {
    const kit = { ...FIGURE, product_type: "Plastic Model" };
    const v = classify(kit);
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.reason, "product_type Plastic Model");
  });

  it("refuses an entry with no type rather than assuming one", () => {
    const v = classify({ ...FIGURE, product_type: "" });
    assert.equal(v.ok, false);
  });
});

describe("parseSpecs", () => {
  it("reads the spec table by name, not by position", () => {
    const s = parseSpecs(PAGE);
    assert.equal(s.series, "The Legend of Heroes");
    assert.equal(s.manufacturer, "KOTOBUKIYA");
    assert.equal(s.specifications, "Pre-Painted Figure");
    assert.equal(s.scale, "1/8");
    assert.equal(s.heightMm, 225);
  });

  it("reads the release month and lands mid-month", () => {
    // Their pages state a month and no day, so the 15th is a placeholder —
    // the same convention as the Good Smile import.
    const s = parseSpecs(PAGE);
    assert.equal(s.releaseDate?.toISOString(), "2027-04-15T00:00:00.000Z");
  });

  it("returns nulls for a page with no spec table", () => {
    const s = parseSpecs("<html><body>nothing here</body></html>");
    assert.deepEqual(s, {
      series: null,
      manufacturer: null,
      specifications: null,
      scale: null,
      heightMm: null,
      releaseDate: null,
    });
  });
});

describe("parseSalesMonth", () => {
  it("takes the forms their pages use", () => {
    assert.equal(parseSalesMonth("April 2027")?.toISOString().slice(0, 10), "2027-04-15");
    assert.equal(parseSalesMonth("  December 2019 ")?.toISOString().slice(0, 10), "2019-12-15");
  });

  it("refuses anything it does not actually understand", () => {
    // Better a null release date — which shows "at today's rate" — than a
    // date invented from a string we did not parse.
    assert.equal(parseSalesMonth("TBA"), null);
    assert.equal(parseSalesMonth("Spring 2027"), null);
    assert.equal(parseSalesMonth("2027-04"), null);
    assert.equal(parseSalesMonth(""), null);
    assert.equal(parseSalesMonth(null), null);
  });
});

describe("parseHeightMm", () => {
  it("reads millimetres and converts centimetres", () => {
    assert.equal(parseHeightMm("225mm tall"), 225);
    assert.equal(parseHeightMm("Total height: approx. 160 mm"), 160);
    assert.equal(parseHeightMm("22.5cm"), 225);
  });

  it("refuses a length as if it were a height", () => {
    // A ZOIDS model states "total length: 380 mm". Storing that in heightMm
    // puts a measured-looking number beside a figure it does not describe.
    assert.equal(parseHeightMm("total length: 380 mm"), null);
    assert.equal(parseHeightMm("width 120mm"), null);
    // Unless the row names a height too, in which case it is usable.
    assert.equal(parseHeightMm("height 180mm / length 300mm"), 180);
  });

  it("leaves units it has not seen alone", () => {
    assert.equal(parseHeightMm('9 inches'), null);
    assert.equal(parseHeightMm("varies"), null);
    assert.equal(parseHeightMm(null), null);
  });
});

describe("parseScale", () => {
  it("pulls the fraction out however it is written", () => {
    assert.equal(parseScale("1/8"), "1/8");
    assert.equal(parseScale("1 / 7 scale"), "1/7");
    assert.equal(parseScale("Non-scale"), null);
  });
});

describe("categoryFor", () => {
  const base = { series: null, manufacturer: null, specifications: null, scale: null, heightMm: null, releaseDate: null };

  it("trusts a stated scale", () => {
    assert.equal(categoryFor({ ...base, scale: "1/8" }), "SCALE");
  });

  it("trusts their own wording when there is no scale", () => {
    assert.equal(categoryFor({ ...base, specifications: "Pre-Painted Figure" }), "SCALE");
    assert.equal(categoryFor({ ...base, specifications: "Plastic Model Kit" }), "MODEL_KIT");
  });

  it("falls back to OTHER rather than guessing from branding", () => {
    // ARTFX J and BISHOUJO are series names, not product types.
    assert.equal(categoryFor(base), "OTHER");
  });
});

describe("statusFor", () => {
  const now = new Date("2026-08-19T00:00:00Z");

  it("calls a future month a preorder and a past one released", () => {
    assert.equal(statusFor(new Date("2027-04-15T00:00:00Z"), now), "PREORDER");
    assert.equal(statusFor(new Date("2019-12-15T00:00:00Z"), now), "RELEASED");
  });

  it("does not treat a missing date as unreleased", () => {
    assert.equal(statusFor(null, now), "RELEASED");
  });
});
