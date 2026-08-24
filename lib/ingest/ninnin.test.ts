import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  categoryFor,
  isFigure,
  parseProductPage,
  tidyName,
  productIdFromUrl,
  productLinks,
  readScale,
  type NinNinProduct,
} from "./ninnin";

/**
 * The markup shapes here are taken from a real product page, including the
 * CDATA wrapper around their JSON-LD — which is the detail that makes a naive
 * JSON.parse fail and would silently cost every barcode on the site.
 */

const PRODUCT_URL =
  "https://www.nin-nin-game.com/en/monster-hunter/254600-monster-hunter-mizutsune-mondefo-flocked-figure-capcom-.html";

function page(over: Partial<Record<string, string>> = {}): string {
  const ld = over.ld ?? JSON.stringify({
    "@context": "https://schema.org/",
    "@type": "Product",
    name: "Monster Hunter: Mizutsune - MonDefo Flocked Figure [Capcom]",
    gtin13: "4976219141666",
    sku: "4976219141666",
    brand: "Capcom",
    offers: {
      url: PRODUCT_URL,
      priceCurrency: "CAD",
      price: "26.13",
      availability: "https://schema.org/InStock",
    },
  });
  const body = over.body ?? "Material : PVC, Nylon Size : (H) 11.7 x 9.1 x 11.3 cm Release Date : 2027/03 Reference: 4976219141666";
  return `<html><head><script type="application/ld+json">/* <![CDATA[ */${ld}/* ]]> */</script></head><body><div>${body}</div></body></html>`;
}

describe("productLinks", () => {
  it("returns each product once, however often it is linked", () => {
    const html = `<a href="${PRODUCT_URL}"><img></a><a href="${PRODUCT_URL}">title</a>
      <a href="https://www.nin-nin-game.com/en/figures/254601-another-thing.html">x</a>`;
    assert.deepEqual(productLinks(html).sort(), [
      "https://www.nin-nin-game.com/en/figures/254601-another-thing.html",
      PRODUCT_URL,
    ].sort());
  });

  it("ignores category links, which carry no product id", () => {
    assert.deepEqual(productLinks(`<a href="https://www.nin-nin-game.com/en/61-figures">Figures</a>`), []);
  });
});

describe("productIdFromUrl", () => {
  it("takes the shop's own id", () => {
    assert.equal(productIdFromUrl(PRODUCT_URL), "254600");
  });

  it("returns null for anything that is not a product", () => {
    assert.equal(productIdFromUrl("https://www.nin-nin-game.com/en/61-figures"), null);
  });
});

describe("parseProductPage", () => {
  it("reads JSON-LD out of its CDATA wrapper", () => {
    const p = parseProductPage(page(), PRODUCT_URL)!;
    // The "[Capcom]" suffix is dropped: the maker is its own column.
    assert.equal(p.name, "Monster Hunter: Mizutsune - MonDefo Flocked Figure");
    // The whole reason this source is worth reading.
    assert.equal(p.jan, "4976219141666");
    assert.equal(p.manufacturer, "Capcom");
    assert.equal(p.priceAmount, 26.13);
    assert.equal(p.priceCurrency, "CAD");
    assert.equal(p.available, true);
  });

  it("reads the release date to the month, and no further", () => {
    const p = parseProductPage(page(), PRODUCT_URL)!;
    assert.equal(p.releaseDate?.toISOString().slice(0, 10), "2027-03-01");
  });

  it("converts the stated height to millimetres", () => {
    const p = parseProductPage(page(), PRODUCT_URL)!;
    assert.equal(p.heightMm, 117);
  });

  it("survives a page with no JSON-LD at all", () => {
    const p = parseProductPage("<html><body>nothing here</body></html>", PRODUCT_URL)!;
    assert.equal(p.name, null);
    assert.equal(p.jan, null);
    assert.equal(p.priceAmount, null);
  });

  it("refuses a barcode that is not one", () => {
    const ld = JSON.stringify({ "@type": "Product", name: "x", gtin13: "n/a", sku: "n/a" });
    assert.equal(parseProductPage(page({ ld }), PRODUCT_URL)!.jan, null);
  });

  it("treats a sold-out product as unavailable", () => {
    const ld = JSON.stringify({
      "@type": "Product", name: "x",
      offers: { price: "10", priceCurrency: "USD", availability: "https://schema.org/OutOfStock" },
    });
    assert.equal(parseProductPage(page({ ld }), PRODUCT_URL)!.available, false);
  });

  it("counts a preorder as available, because they will take the order", () => {
    const ld = JSON.stringify({
      "@type": "Product", name: "x",
      offers: { price: "10", priceCurrency: "USD", availability: "https://schema.org/PreOrder" },
    });
    assert.equal(parseProductPage(page({ ld }), PRODUCT_URL)!.available, true);
  });

  it("returns null when the url names no product", () => {
    assert.equal(parseProductPage(page(), "https://www.nin-nin-game.com/en/61-figures"), null);
  });
});

describe("readScale", () => {
  it("finds the scale where they write it, in the name", () => {
    assert.equal(readScale("Rem - 1/7 Scale Figure [Kadokawa]"), "1/7");
    assert.equal(readScale("Something 1 / 8 scale"), "1/8");
  });

  it("is null when there is no scale to find", () => {
    assert.equal(readScale("Nendoroid Hatsune Miku"), null);
    assert.equal(readScale(null), null);
  });
});

function product(over: Partial<NinNinProduct>): NinNinProduct {
  return {
    productId: "1", url: PRODUCT_URL, name: null, jan: null, manufacturer: null,
    priceAmount: null, priceCurrency: null, available: true, releaseDate: null,
    scale: null, heightMm: null, ...over,
  };
}

describe("categoryFor", () => {
  it("reads the product line out of the name", () => {
    assert.equal(categoryFor(product({ name: "Nendoroid Hatsune Miku" })), "NENDOROID");
    assert.equal(categoryFor(product({ name: "figma Guts" })), "FIGMA");
    assert.equal(categoryFor(product({ name: "Pikachu Plush" })), "PLUSH");
  });

  it("falls back to the scale when the line is not named", () => {
    assert.equal(categoryFor(product({ name: "Rem 1/7", scale: "1/7" })), "SCALE");
  });

  it("knows MODEROID is a model kit, though the name never says so", () => {
    assert.equal(categoryFor(product({ name: "MODEROID: Linebarrels of Iron - Vardant" })), "MODEL_KIT");
  });

  it("says OTHER rather than guessing", () => {
    assert.equal(categoryFor(product({ name: "Some Statue Thing" })), "OTHER");
  });
});

describe("isFigure", () => {
  it("rejects the games and books they sell beside the figures", () => {
    for (const name of [
      "Persona 5 Royal - Nintendo Switch",
      "Attack on Titan Blu-ray Box",
      "Pokemon TCG Booster Box",
    ]) {
      assert.equal(isFigure(product({ name })), false, name);
    }
  });

  it("accepts a figure", () => {
    assert.equal(isFigure(product({ name: "Nendoroid Hatsune Miku" })), true);
  });

  it("rejects a product with no name, which is nothing we can describe", () => {
    assert.equal(isFigure(product({ name: null })), false);
  });

  it("rejects a figure line's merchandise, which shares its name", () => {
    // All real entries from their new-products listing.
    for (const name of [
      "Monster Hunter: Zinogre - MonDefo Fuwa Fuwa Poncho",
      "Monster Hunter: Rathalos - MonDefo Drawstring Pouch",
      "Monster Hunter: Gypceros - MonDefo Plush Badge",
      "Hatsune Miku Acrylic Stand",
    ]) {
      assert.equal(isFigure(product({ name })), false, name);
    }
  });

  it("rejects a used copy, which is a listing and not a product", () => {
    // Real titles. Importing these puts the same figure in twice, differing
    // only by the condition of one seller's box.
    for (const name of [
      "Baki-Dou: Yujiro Hanma - Luminasta (2nd Hand)",
      "Hatsune Miku Flower Fairy: Bellflower - Noodle Stopper Figure (2nd Hand)",
    ]) {
      assert.equal(isFigure(product({ name })), false, name);
    }
  });

  it("rejects art books and homeware, which are not figures however they are filed", () => {
    assert.equal(isFigure(product({ name: "Kiriko Arai Art Collection: Somewhere" })), false);
    assert.equal(isFigure(product({ name: "Livly Island Art Works" })), false);
    assert.equal(isFigure(product({ name: "Chiikawa: Stainless Steel Bottle 480ml" })), false);
  });

  it("still accepts a plush toy, which is a category here", () => {
    assert.equal(isFigure(product({ name: "Monster Hunter: Kulu-Ya-Ku - MonDefo Plush Toy" })), true);
  });
});

describe("tidyName", () => {
  it("drops the maker the shop appends in brackets", () => {
    assert.equal(tidyName("Rem - 1/7 Scale Figure [Kadokawa]"), "Rem - 1/7 Scale Figure");
  });

  it("keeps brackets that belong to the character's name", () => {
    assert.equal(
      tidyName("figma Saber/Altria Pendragon [Lily] Third Ascension"),
      "figma Saber/Altria Pendragon [Lily] Third Ascension",
    );
  });

  it("decodes the entities their JSON-LD still carries", () => {
    assert.equal(
      tidyName("Monster Hunter: Rathalos &amp; Lagiacrus - Mondefo Jacquard"),
      "Monster Hunter: Rathalos & Lagiacrus - Mondefo Jacquard",
    );
  });

  it("is null for nothing", () => {
    assert.equal(tidyName(null), null);
    assert.equal(tidyName("   "), null);
  });
});
