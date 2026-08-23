import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksJapanese, upcFromKotobukiyaUrl } from "./barcode";

describe("upcFromKotobukiyaUrl", () => {
  it("reads the barcode Kotobukiya uses as a URL handle", () => {
    assert.equal(
      upcFromKotobukiyaUrl("https://kotobukiya-us.com/products/190526084803"),
      "190526084803",
    );
  });

  it("ignores a handle that is a slug rather than a barcode", () => {
    assert.equal(upcFromKotobukiyaUrl("https://kotobukiya-us.com/products/bishoujo-statue"), null);
  });

  it("refuses a URL belonging to anybody else", () => {
    // The same shape of path exists on every Shopify store in the world.
    assert.equal(upcFromKotobukiyaUrl("https://solarisjapan.com/products/190526084803"), null);
    assert.equal(upcFromKotobukiyaUrl(null), null);
  });
});

describe("looksJapanese", () => {
  it("accepts the GS1 prefixes Japan issues", () => {
    assert.equal(looksJapanese("4570232588233"), true);
    assert.equal(looksJapanese("4580590174153"), true);
    assert.equal(looksJapanese("4934054123456"), true);
  });

  it("rejects an American barcode", () => {
    // The whole point of the check. A UPC stored as a JAN would send a reader
    // to search a Japanese marketplace for a number printed on a US box.
    assert.equal(looksJapanese("190526084803"), false);
    assert.equal(looksJapanese("0190526084803"), false);
  });
});
