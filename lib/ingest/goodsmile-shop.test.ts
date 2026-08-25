import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseShopProduct, shopName } from "./goodsmile-shop";

/** Shapes taken from live shop pages: ids 1, 5000, 7310, 12500. */
function page(node: Record<string, unknown>): string {
  return `<html><head><script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org/",
    "@type": "Product",
    ...node,
  })}</script></head><body></body></html>`;
}

describe("shopName", () => {
  it("unwraps a reissue title", () => {
    assert.equal(shopName("Rerelease [MODEROID Gambaruger]"), "MODEROID Gambaruger");
    assert.equal(shopName("Re-release [Nendoroid Hatsune Miku]"), "Nendoroid Hatsune Miku");
  });

  it("leaves an ordinary title alone", () => {
    assert.equal(shopName("figma Shielder/Mash Kyrielight: Casual ver."), "figma Shielder/Mash Kyrielight: Casual ver.");
  });

  it("does not unwrap brackets that are part of the name", () => {
    // Only a whole-title wrapper counts; a bracket inside a name is the name's.
    assert.equal(
      shopName("figma Saber/Altria Pendragon [Lily]"),
      "figma Saber/Altria Pendragon [Lily]",
    );
  });
});

describe("parseShopProduct", () => {
  it("reads the name, barcode and maker", () => {
    const p = parseShopProduct(
      page({ name: "figma Shielder/Mash Kyrielight: Casual ver.", gtin: "4545784065433", brand: "Max Factory" }),
    )!;
    assert.equal(p.name, "figma Shielder/Mash Kyrielight: Casual ver.");
    assert.equal(p.gtin, "4545784065433");
    assert.equal(p.brand, "Max Factory");
  });

  it("takes gtin, which is what the shop actually uses", () => {
    // gtin13 is absent on every shop page checked; reading only that found none.
    assert.equal(parseShopProduct(page({ name: "x", gtin: "4570232580718" }))!.gtin, "4570232580718");
  });

  it("still accepts gtin13 where a page carries it", () => {
    assert.equal(parseShopProduct(page({ name: "x", gtin13: "4570232580718" }))!.gtin, "4570232580718");
  });

  it("unwraps a reissue on the way through", () => {
    assert.equal(parseShopProduct(page({ name: "Rerelease [MODEROID Gambaruger]" }))!.name, "MODEROID Gambaruger");
  });

  it("reads a brand given as an object", () => {
    assert.equal(parseShopProduct(page({ name: "x", brand: { name: "Good Smile Company" } }))!.brand, "Good Smile Company");
  });

  it("returns a product with no barcode rather than nothing", () => {
    // Some products genuinely have none; that is not a parse failure.
    const p = parseShopProduct(page({ name: "figma Kagamine Rin" }))!;
    assert.equal(p.name, "figma Kagamine Rin");
    assert.equal(p.gtin, null);
  });

  it("refuses a gtin that is not digits", () => {
    assert.equal(parseShopProduct(page({ name: "x", gtin: "n/a" }))!.gtin, null);
  });

  it("is null for a page with no product on it", () => {
    assert.equal(parseShopProduct("<html><body>404</body></html>"), null);
    assert.equal(parseShopProduct(page({ name: "" })), null);
  });

  it("skips a non-Product block to find the Product one", () => {
    const html = `<html><script type="application/ld+json">{"@type":"BreadcrumbList"}</script>
      ${page({ name: "Nendoroid Kazuma", gtin: "4580416904940" })}</html>`;
    assert.equal(parseShopProduct(html)!.name, "Nendoroid Kazuma");
  });
});
