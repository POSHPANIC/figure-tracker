import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { linkFor, specKey, type FigureLike, type StoredProduct } from "./source-product";

const stored = (over: Partial<StoredProduct> = {}): StoredProduct => ({
  nameJa: "花火",
  jan: null,
  manufacturerName: "Alter",
  scale: "1/7",
  heightMm: 230,
  releaseDate: new Date("2027-10-01T00:00:00Z"),
  ...over,
});

const figure = (id: string, over: Partial<FigureLike> = {}): FigureLike => ({
  id,
  nameJa: "花火",
  manufacturerName: "Alter",
  scale: "1/7",
  heightMm: 230,
  releaseDate: new Date("2027-10-01T00:00:00Z"),
  ...over,
});

describe("specKey", () => {
  it("needs every part, because three of four is a coincidence", () => {
    assert.ok(specKey(stored()) !== null);
    assert.equal(specKey(stored({ scale: null })), null);
    assert.equal(specKey(stored({ heightMm: null })), null);
    assert.equal(specKey(stored({ releaseDate: null })), null);
    assert.equal(specKey(stored({ manufacturerName: null })), null);
  });

  it("compares the month, which is as precisely as either side states it", () => {
    assert.equal(
      specKey(stored({ releaseDate: new Date("2027-10-31T00:00:00Z") })),
      specKey(stored({ releaseDate: new Date("2027-10-01T00:00:00Z") })),
    );
  });

  it("reads a date that arrived as a string", () => {
    assert.equal(specKey(stored({ releaseDate: "2027-10-01T00:00:00.000Z" })), specKey(stored()));
  });

  it("ignores the maker's capitalisation but not its identity", () => {
    assert.equal(specKey(stored({ manufacturerName: "ALTER" })), specKey(stored()));
    assert.notEqual(specKey(stored({ manufacturerName: "Alphamax" })), specKey(stored()));
  });
});

describe("linkFor", () => {
  it("links on a Japanese name that only one figure has", () => {
    const link = linkFor(stored(), [figure("a"), figure("b", { nameJa: "別の名前" })]);
    assert.deepEqual(link, { figureId: "a", by: "nameJa" });
  });

  it("folds width and spacing before comparing the name", () => {
    const link = linkFor(stored({ nameJa: "花 火" }), [figure("a")]);
    assert.equal(link?.figureId, "a");
  });

  it("refuses a name match from a different maker", () => {
    // A Japanese name is usually the character's, shared by every maker who
    // sculpted her. Matching on it alone proposed 40 links and 39 were wrong.
    assert.equal(linkFor(stored(), [figure("a", { manufacturerName: "Max Factory" })]), null);
  });

  it("will not use a name match when either side names no maker", () => {
    assert.equal(linkFor(stored({ manufacturerName: null }), [figure("a")]), null);
    assert.equal(linkFor(stored({ scale: null }), [figure("a", { manufacturerName: null })]), null);
  });

  it("refuses when two figures share the Japanese name", () => {
    // Guessing here writes a manufacturer's price onto the wrong product.
    assert.equal(linkFor(stored(), [figure("a"), figure("b")]), null);
  });

  it("falls back to the specification key when no name matches", () => {
    const link = linkFor(stored({ nameJa: "誰も持っていない名前" }), [
      figure("a", { nameJa: null }),
      figure("b", { nameJa: null, heightMm: 180 }),
    ]);
    assert.deepEqual(link, { figureId: "a", by: "specs" });
  });

  it("refuses when the specification key belongs to more than one figure", () => {
    // 9% of the catalogue's keys collide, which is why uniqueness is checked
    // rather than assumed.
    const link = linkFor(stored({ nameJa: null }), [
      figure("a", { nameJa: null }),
      figure("b", { nameJa: null }),
    ]);
    assert.equal(link, null);
  });

  it("refuses when the product states too little to key on", () => {
    assert.equal(linkFor(stored({ nameJa: null, scale: null }), [figure("a", { nameJa: null })]), null);
  });

  it("refuses when nothing matches at all", () => {
    assert.equal(
      linkFor(stored({ nameJa: "知らない" }), [figure("a", { nameJa: null, manufacturerName: "Phat!" })]),
      null,
    );
  });
});
