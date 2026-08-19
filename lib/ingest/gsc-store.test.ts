import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { archiveProductUrl, findStoreLinks } from "./gsc-store";

/**
 * The hrefs here are copied from real archive pages, tracking parameters and
 * doubled slashes included.
 */
describe("findStoreLinks", () => {
  it("finds both stores on a recent product", () => {
    const html = `
      <a href="https://goodsmileshop.com/en/p/FRE_WD_00602/?utm_source=internal&utm_medium=banner">SHOP</a>
      <a href="https://www.goodsmileus.com/product/usada-pekora-12112//?utm_source=internal">SHOP US</a>
      <a href="http://goodsmileshop.com">GOODSMILE ONLINE SHOP</a>
    `;
    assert.deepEqual(findStoreLinks(html), {
      us: "https://www.goodsmileus.com/product/usada-pekora-12112/",
      international: "https://goodsmileshop.com/en/p/FRE_WD_00602/",
    });
  });

  it("drops the tracking Good Smile puts on its own links", () => {
    // Following these would file our visitors as the manufacturer's own
    // traffic, which defeats the reason for sending them.
    const html = `<a href="https://www.goodsmileus.com/product/nendoroid-yami-bakura-7542/?utm_source=internal&utm_medium=x&utm_campaign=y">x</a>`;
    assert.equal(
      findStoreLinks(html).us,
      "https://www.goodsmileus.com/product/nendoroid-yami-bakura-7542/",
    );
  });

  it("ignores the shop's front door", () => {
    // What every product from before about 2020 offers, and it tells a visitor
    // nothing. A "buy this figure" link landing on a homepage is worse than none.
    const html = `<a href="http://goodsmileshop.com">GOODSMILE ONLINE SHOP</a>`;
    assert.deepEqual(findStoreLinks(html), { us: null, international: null });
  });

  it("ignores corporate and recruitment links", () => {
    const html = `
      <a href="https://corporate.goodsmile.com/en/">Company</a>
      <a href="https://corporate.goodsmile.com/ja/recruit/tryout/">Jobs</a>
      <a href="https://rakutsuki.goodsmile.com/">Rakutsuki</a>
    `;
    assert.deepEqual(findStoreLinks(html), { us: null, international: null });
  });

  it("takes one of each when a page repeats them", () => {
    const html = `
      <a href="https://www.goodsmileus.com/product/a-1/">top</a>
      <a href="https://www.goodsmileus.com/product/a-1/">bottom</a>
    `;
    assert.equal(findStoreLinks(html).us, "https://www.goodsmileus.com/product/a-1/");
  });

  it("builds the archive url from a product id", () => {
    assert.equal(archiveProductUrl("15329"), "https://www.goodsmile.info/en/product/15329/");
  });
});
