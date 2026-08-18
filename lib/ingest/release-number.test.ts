import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { candidateKey, readReleaseNumber } from "./release-number";

/**
 * Every title here is real, taken from the listing table. The rejections are
 * the point: this reader is what decides that a product nobody has catalogued
 * exists, so a false positive invents a figure out of a seller's shorthand.
 */
describe("readReleaseNumber", () => {
  it("reads a bare number of three or four digits", () => {
    assert.deepEqual(readReleaseNumber("Nendoroid 2509 NANA Nana Osaki Action Figure Good Smile"), {
      line: "NENDOROID",
      number: "2509",
    });
    assert.deepEqual(readReleaseNumber("Good Smile Company figma 628 Alice Goddess of Official"), {
      line: "FIGMA",
      number: "628",
    });
  });

  it("reads a number the seller marked with No. or #", () => {
    assert.deepEqual(readReleaseNumber("Nendoroid #1538 Hatsune Miku 5th Anniversary Symphony"), {
      line: "NENDOROID",
      number: "1538",
    });
    assert.deepEqual(readReleaseNumber("Vocaloid Nendoroid No.2878 Hatsune Miku (2025 Sapporo)"), {
      line: "NENDOROID",
      number: "2878",
    });
    // Marked, so two digits are enough — the seller is telling us it is a
    // release number rather than leaving us to infer it.
    assert.deepEqual(readReleaseNumber("Good Smile Company Nendoroid #77 Saber Lily Fate"), {
      line: "NENDOROID",
      number: "77",
    });
  });

  it("refuses a measurement", () => {
    assert.equal(readReleaseNumber("Gsc Jesse Light And Night Nendoroid 10cm Action Figure"), null);
    assert.equal(readReleaseNumber("Bananafish Ash Lynx Eiji Okumura Nendoroid 9.5cm 3.7\""), null);
    assert.equal(readReleaseNumber('Bruce Lee - Bruce Lee Nendoroid 4" Action Figure "New"'), null);
    assert.equal(readReleaseNumber("Nendoroid 100mm Figure"), null);
  });

  it("refuses a revision number", () => {
    assert.equal(readReleaseNumber("Light Yagami Nendoroid 2.0 Figure DEATH NOTE Good Smile"), null);
  });

  it("refuses an anniversary", () => {
    assert.equal(readReleaseNumber("MAX FACTORY FIGMA 15TH ANNIVERSARY GUYVER I ULTIMATE"), null);
    assert.equal(readReleaseNumber("figma 20th anniversary set"), null);
  });

  it("ignores a bare one or two digit number", () => {
    // The cost is a few genuine early releases, all of which we already hold.
    // The benefit is every "Nendoroid 2" that meant something else.
    assert.equal(readReleaseNumber("Nendoroid 12 Figure Lot"), null);
    assert.equal(readReleaseNumber("figma 9 action figure"), null);
  });

  it("ignores a title with no number at all", () => {
    assert.equal(readReleaseNumber("Nendoroid Snow Miku Sweet Snow Ver. Good Smile Company"), null);
    assert.equal(readReleaseNumber("POP UP PARADE Ichigo Kurosaki"), null);
  });

  it("does not read a number belonging to another line", () => {
    assert.equal(readReleaseNumber("Pop Up Parade 1234 Figure"), null);
  });

  it("normalises leading zeros so one product has one key", () => {
    const padded = readReleaseNumber("Nendoroid No.0077 Saber Lily");
    const plain = readReleaseNumber("Nendoroid #77 Saber Lily");
    assert.deepEqual(padded, plain);
    assert.equal(candidateKey(padded!), "NENDOROID:77");
  });

  it("tells the two lines apart", () => {
    assert.equal(readReleaseNumber("figma 628 Alice")!.line, "FIGMA");
    assert.equal(readReleaseNumber("Nendoroid 628 Alice")!.line, "NENDOROID");
  });
});
