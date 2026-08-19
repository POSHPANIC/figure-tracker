import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ebaySearchQuery, ebaySearchUrl } from "./ebay-search";

const figure = { name: "Nendoroid Usada Pekora", manufacturer: { name: "Good Smile Company" } };

describe("ebaySearchQuery", () => {
  it("searches for the maker and the product together", () => {
    assert.equal(ebaySearchQuery(figure), "Good Smile Company Nendoroid Usada Pekora");
  });

  it("copes with a figure whose maker is unknown", () => {
    assert.equal(ebaySearchQuery({ name: "Usada Pekora" }), "Usada Pekora");
  });
});

describe("ebaySearchUrl", () => {
  it("searches both conditions when none is given", () => {
    assert.equal(ebaySearchUrl(figure).includes("LH_ItemCondition"), false);
  });

  it("follows the condition tabs", () => {
    // Verified against live results before being written down: the same query
    // returns 163 items under 1000 and 153 under 3000.
    assert.match(ebaySearchUrl(figure, "NEW_SEALED"), /LH_ItemCondition=1000/);
    assert.match(ebaySearchUrl(figure, "USED_COMPLETE"), /LH_ItemCondition=3000/);
  });

  it("searches both for a condition eBay has no filter for", () => {
    // Guessing one would narrow the results on a fact nobody established.
    assert.equal(ebaySearchUrl(figure, "UNKNOWN").includes("LH_ItemCondition"), false);
  });

  it("keeps the query alongside the filter", () => {
    const url = ebaySearchUrl(figure, "NEW_SEALED");
    assert.match(url, /_nkw=Good\+Smile\+Company\+Nendoroid\+Usada\+Pekora/);
  });
});
