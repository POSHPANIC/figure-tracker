import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classify,
  parseHeightMm,
  parseListing,
  parsePriceJpy,
  parseProduct,
  parseReleaseDate,
  parseScale,
  rejectedByCategory,
  splitJapaneseReading,
  type GscListItem,
} from "./gsc";

/**
 * Fixtures are real markup captured from goodsmile.info, trimmed to the parts
 * being parsed. Invented HTML would only prove the regexes match themselves.
 */

const TILE_NENDOROID = `
<div class="hitItem nendoroid nendoroid_series  ">
  <div class="hitBox  ">
    <a href="/en/product/15400/Nendoroid+Mia+Luna+Tearmoon.html">
      <img data-original="//images.goodsmile.info/cgm/images/product/20231225/15400/125204/large/b261.jpg" class="itemImg" alt="" />
      <span class="hitTtl">
        <span>Nendoroid Mia Luna Tearmoon</span>
      </span>
      <span class="hitNum nendoroid">2346</span>
    </a>
  </div>
</div>`;

const TILE_MODEROID = `
<div class="hitItem plasticmodel moderoid otherfigures_nest plasticmodel  ">
  <div class="hitBox  ">
    <a href="/en/product/15277/MODEROID+Full+Power+Gridknight.html">
      <span class="hitTtl">
        <span>MODEROID Full Power Gridknight</span>
      </span>
    </a>
  </div>
</div>`;

const TILE_GOODS = `
<div class="hitItem goods goodsother  ">
  <div class="hitBox  ">
    <a href="/en/product/15100/FLUFFY+LAND+Mouse+Pad.html">
      <span class="hitTtl">
        <span>FLUFFY LAND Mouse Pad</span>
      </span>
    </a>
  </div>
</div>`;

const LISTING = `<title>Products - Page 2 of 290</title>${TILE_NENDOROID}${TILE_MODEROID}${TILE_GOODS}`;

/** A product page: the footer <dl> comes first, exactly as the real page has it. */
const PRODUCT_PAGE = `
<dl class="footerLinks">
  <dt>GOOD SMILE COMPANY</dt><dd>Corporate Profile</dd>
  <dt>LINKS</dt><dd>Gift Phat! FREEing</dd>
</dl>
<dl id="itemInfo">
  <dt>Product Name</dt><dd>The Eminence in Shadow Light Novel Ver. Beta</dd>
  <dt>Series</dt><dd>The Eminence in Shadow</dd>
  <dt>Manufacturer</dt><dd>KADOKAWA Corporation</dd>
  <dt>Category</dt><dd>1/7th Scale</dd>
  <dt>Price</dt><dd>&yen;32,300</dd>
  <dt>Release Date</dt><dd>2024/10</dd>
  <dt>Specifications</dt><dd>Painted plastic 1/7 scale complete product with stand included. Approximately 280mm in height.</dd>
  <dt>Sculptor</dt><dd>Mamoru Manzoku</dd>
</dl>`;

function tile(overrides: Partial<GscListItem> = {}): GscListItem {
  return {
    productId: "15400",
    path: "/en/product/15400/Nendoroid+Mia+Luna+Tearmoon.html",
    name: "Nendoroid Mia Luna Tearmoon",
    classes: ["nendoroid", "nendoroid_series"],
    lineNumber: "2346",
    imageUrl: null,
    ...overrides,
  };
}

const SPECS = {
  "Product Name": "Nendoroid Mia Luna Tearmoon",
  Series: "Tearmoon Empire",
  Manufacturer: "Good Smile Company",
  Category: "Nendoroid",
  Price: "¥5,500",
  "Release Date": "2024/05",
  Specifications:
    "Painted plastic non-scale articulated figure with stand included. Approximately 100mm in height.",
};

describe("parseListing", () => {
  it("pulls id, path, name and classes from a tile", () => {
    const { items } = parseListing(LISTING);
    assert.equal(items.length, 3);
    assert.equal(items[0].productId, "15400");
    assert.equal(items[0].path, "/en/product/15400/Nendoroid+Mia+Luna+Tearmoon.html");
    assert.deepEqual(items[0].classes, ["nendoroid", "nendoroid_series"]);
  });

  it("keeps the release number out of the name", () => {
    const { items } = parseListing(LISTING);
    assert.equal(items[0].name, "Nendoroid Mia Luna Tearmoon");
    assert.equal(items[0].lineNumber, "2346");
  });

  it("makes the protocol-relative image URL absolute", () => {
    const { items } = parseListing(LISTING);
    assert.ok(items[0].imageUrl?.startsWith("https://images.goodsmile.info/"));
  });

  it("reads the total page count", () => {
    assert.equal(parseListing(LISTING).totalPages, 290);
  });

  it("returns nothing rather than throwing on unrelated markup", () => {
    const { items, totalPages } = parseListing("<html><body>no products</body></html>");
    assert.equal(items.length, 0);
    assert.equal(totalPages, null);
  });
});

describe("parseProduct", () => {
  it("reads the spec table and not the footer link list", () => {
    const fields = parseProduct(PRODUCT_PAGE);
    assert.ok(fields);
    assert.equal(fields["Manufacturer"], "KADOKAWA Corporation");
    assert.equal(fields["Category"], "1/7th Scale");
    // The footer <dl> also has <dt>/<dd> pairs; they must not leak in.
    assert.equal(fields["LINKS"], undefined);
  });

  it("decodes entities in values", () => {
    assert.equal(parseProduct(PRODUCT_PAGE)?.["Price"], "¥32,300");
  });

  it("returns null when there is no product table", () => {
    assert.equal(parseProduct("<dl><dt>LINKS</dt><dd>Gift</dd></dl>"), null);
  });
});

describe("field parsing", () => {
  it("reads a yen price", () => {
    assert.equal(parsePriceJpy("¥32,300"), 32300);
    assert.equal(parsePriceJpy("¥1,019"), 1019);
  });

  it("has no price rather than a wrong one", () => {
    assert.equal(parsePriceJpy("Open price"), null);
    assert.equal(parsePriceJpy(undefined), null);
  });

  it("takes the earliest of several release dates", () => {
    assert.deepEqual(parseReleaseDate("2024/02 (Event Sales) / 2024/07 (Preorders)"), {
      year: 2024,
      month: 2,
    });
  });

  it("reads a single release date", () => {
    assert.deepEqual(parseReleaseDate("2024/10"), { year: 2024, month: 10 });
  });

  it("rejects a nonsense month", () => {
    assert.equal(parseReleaseDate("2024/13"), null);
  });

  it("reads the scale, and treats non-scale as no scale", () => {
    assert.equal(parseScale("Painted plastic 1/7 scale complete product."), "1/7");
    assert.equal(parseScale("Painted plastic non-scale articulated figure."), null);
  });

  it("reads height in mm and cm", () => {
    assert.equal(parseHeightMm("Approximately 280mm in height."), 280);
    assert.equal(parseHeightMm("Approximately 25cm in height."), 250);
    assert.equal(parseHeightMm("no measurement here"), null);
  });
});

describe("splitJapaneseReading", () => {
  it("splits the kana reading the old archive appends to names", () => {
    // Real entries from 2007-2008 pages of the archive.
    assert.deepEqual(splitJapaneseReading("Nanoha Takamachi (たかまちなのは)"), {
      name: "Nanoha Takamachi",
      nameJa: "たかまちなのは",
    });
    assert.deepEqual(splitJapaneseReading("Klaus' Vanship (う゛ぁんしっぷ くらうすき)"), {
      name: "Klaus' Vanship",
      nameJa: "う゛ぁんしっぷ くらうすき",
    });
  });

  it("leaves English qualifiers in the name", () => {
    assert.deepEqual(splitJapaneseReading("Nendoroid Hatsune Miku (Reissue)"), {
      name: "Nendoroid Hatsune Miku (Reissue)",
      nameJa: null,
    });
    assert.deepEqual(splitJapaneseReading("Nendoroid More: Face Parts Case (Penguin)"), {
      name: "Nendoroid More: Face Parts Case (Penguin)",
      nameJa: null,
    });
  });

  it("leaves a name that is entirely Japanese alone", () => {
    assert.deepEqual(splitJapaneseReading("初音ミク"), { name: "初音ミク", nameJa: null });
  });

  it("leaves a plain name alone", () => {
    assert.deepEqual(splitJapaneseReading("figma Gawr Gura"), {
      name: "figma Gawr Gura",
      nameJa: null,
    });
  });

  it("keeps the reading out of the catalogue name when classifying", () => {
    const result = classify(tile({ name: "Nanoha Takamachi (たかまちなのは)" }), {
      ...SPECS,
      "Product Name": "Nanoha Takamachi (たかまちなのは)",
    });
    assert.ok(result.ok);
    assert.equal(result.figure.name, "Nanoha Takamachi");
    assert.equal(result.figure.nameJa, "たかまちなのは");
  });
});

describe("classify — only figures get through", () => {
  it("accepts a Nendoroid and reads its facts", () => {
    const result = classify(tile(), SPECS);
    assert.ok(result.ok);
    assert.equal(result.figure.category, "NENDOROID");
    assert.equal(result.figure.manufacturer, "Good Smile Company");
    assert.equal(result.figure.msrpJpy, 5500);
    assert.equal(result.figure.releaseYear, 2024);
    assert.equal(result.figure.heightMm, 100);
    assert.equal(result.figure.scale, null);
  });

  it("files a scale figure under SCALE with its scale", () => {
    const result = classify(
      tile({ classes: ["scale1-7", "scale"], name: "Clementine" }),
      parseProduct(PRODUCT_PAGE)!,
    );
    assert.ok(result.ok);
    assert.equal(result.figure.category, "SCALE");
    assert.equal(result.figure.scale, "1/7");
    assert.equal(result.figure.heightMm, 280);
  });

  it("rejects merchandise", () => {
    const result = classify(tile({ classes: ["goods", "goodsother"] }), SPECS);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "non-figure category");
  });

  it("rejects a model kit even though it also carries a figure class", () => {
    // The trap this exists for: MODEROID kits are tagged `otherfigures_nest`.
    const result = classify(
      tile({ classes: ["plasticmodel", "moderoid", "otherfigures_nest"] }),
      SPECS,
    );
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.detail, "plasticmodel");
  });

  it("rejects parts sold under a figure line's name", () => {
    const result = classify(tile({ classes: ["nendoroidmore", "nendoroid_series"] }), SPECS);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "non-figure category");
  });

  it("rejects an accessory whose class looks fine", () => {
    const result = classify(
      tile({ classes: ["figma"], name: "figma Table Museum Display Case" }),
      SPECS,
    );
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "accessory name");
  });

  it("rejects a category it has never seen rather than guessing", () => {
    const result = classify(tile({ classes: ["someNewLine2027"] }), SPECS);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "unknown category");
  });

  it("rejects an item with no spec table", () => {
    const result = classify(tile(), null);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "no spec table");
  });
});

describe("rejectedByCategory", () => {
  it("rules out merchandise without needing the product page", () => {
    assert.ok(rejectedByCategory(tile({ classes: ["goods", "goodsother"] })));
  });

  it("lets a figure through to be fetched", () => {
    assert.equal(rejectedByCategory(tile()), null);
  });
});
