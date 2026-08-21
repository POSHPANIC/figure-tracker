import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decide, fromName, fromRetailerTags } from "./nsfw";

describe("fromRetailerTags", () => {
  it("takes the retailer's own classification, both ways", () => {
    assert.deepEqual(fromRetailerTags(["General", "nsfw"], "solaris"), { nsfw: true, source: "solaris" });
    assert.deepEqual(fromRetailerTags(["Prize", "sfw"], "solaris"), { nsfw: false, source: "solaris" });
  });

  it("says nothing when they have not classified it", () => {
    assert.equal(fromRetailerTags(["Prize", "Nendoroid"], "solaris"), null);
    assert.equal(fromRetailerTags([], "solaris"), null);
    assert.equal(fromRetailerTags(null, "solaris"), null);
  });
});

describe("fromName", () => {
  it("flags terms that describe the product itself", () => {
    assert.equal(fromName("Nendoroid Something Cast Off Ver.")?.nsfw, true);
    assert.equal(fromName("B-style Lupusregina Beta 1/4 Bunny Ver.")?.source, "keyword:b-style");
    assert.equal(fromName("Some Figure R-18 Ver.")?.source, "keyword:r18");
  });

  it("leaves ordinary figures alone", () => {
    // A swimsuit is not a content warning. A filter that hides half the
    // catalogue is one nobody leaves switched on.
    for (const name of [
      "Nendoroid Asagi Mutsuki",
      "figma Touma Kamijou",
      "1/7 Hatsune Miku Swimsuit Ver.",
      "Pop Up Parade Dorothy Haze",
      "Maid Ver. 1/7 Scale Figure",
    ]) {
      assert.equal(fromName(name), null, name);
    }
  });

  it("marks its own guesses as guesses", () => {
    // Without the source, a guess from a word and a retailer's classification
    // become the same boolean and the weak one can never be revisited.
    assert.match(fromName("Cast Off Ver.")!.source, /^keyword:/);
  });
});

describe("decide", () => {
  it("lets a retailer overrule our reading of the name", () => {
    // They have the product in hand; we have a word. If they say it is fine,
    // it is fine.
    const v = decide({ retailerTags: ["sfw"], retailer: "solaris", name: "B-style Something Bunny Ver." });
    assert.deepEqual(v, { nsfw: false, source: "solaris" });
  });

  it("falls back to the name when nobody has classified it", () => {
    const v = decide({ retailerTags: [], name: "Something Cast Off Ver." });
    assert.equal(v?.nsfw, true);
    assert.match(v!.source, /^keyword:/);
  });

  it("returns nothing when there is neither evidence nor a signal", () => {
    assert.equal(decide({ name: "Nendoroid Asagi Mutsuki" }), null);
  });
});
