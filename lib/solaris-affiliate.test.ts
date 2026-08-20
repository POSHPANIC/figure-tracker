import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

/** Re-import with a given env, since the id is read once at module load. */
async function load(id?: string) {
  if (id === undefined) delete process.env.SOLARIS_AFFILIATE_ID;
  else process.env.SOLARIS_AFFILIATE_ID = id;
  const mod = await import(`./solaris-affiliate?${Math.random()}`);
  return mod as typeof import("./solaris-affiliate");
}

afterEach(() => {
  delete process.env.SOLARIS_AFFILIATE_ID;
});

describe("withSolarisAffiliate", () => {
  it("leaves links alone until an id is configured", async () => {
    const { withSolarisAffiliate, solarisAffiliateEnabled } = await load();
    assert.equal(solarisAffiliateEnabled(), false);
    assert.equal(
      withSolarisAffiliate("https://solarisjapan.com/products/x"),
      "https://solarisjapan.com/products/x",
    );
  });

  it("tags a product link once an id is set", async () => {
    const { withSolarisAffiliate } = await load("1160");
    assert.equal(
      withSolarisAffiliate("https://solarisjapan.com/products/x"),
      "https://solarisjapan.com/products/x?aff=1160",
    );
  });

  it("replaces an existing tag rather than adding a second", async () => {
    const { withSolarisAffiliate } = await load("1160");
    assert.equal(
      withSolarisAffiliate("https://solarisjapan.com/products/x?aff=999"),
      "https://solarisjapan.com/products/x?aff=1160",
    );
  });

  it("keeps other query parameters", async () => {
    const { withSolarisAffiliate } = await load("1160");
    assert.match(withSolarisAffiliate("https://solarisjapan.com/products/x?variant=7"), /variant=7/);
  });

  it("refuses a host that merely contains their name", async () => {
    // The mistake this codebase already made once with eBay, caught by a test
    // exactly like this one.
    const { withSolarisAffiliate } = await load("1160");
    for (const url of [
      "https://solarisjapan.com.example.net/products/x",
      "https://notsolarisjapan.com/products/x",
      "https://example.com/?u=solarisjapan.com",
    ]) {
      assert.equal(withSolarisAffiliate(url), url, url);
    }
  });

  it("accepts the www host", async () => {
    const { withSolarisAffiliate } = await load("1160");
    assert.match(withSolarisAffiliate("https://www.solarisjapan.com/products/x"), /aff=1160/);
  });

  it("does not touch a url it cannot parse or a non-web scheme", async () => {
    const { withSolarisAffiliate } = await load("1160");
    assert.equal(withSolarisAffiliate("not a url"), "not a url");
    assert.equal(withSolarisAffiliate("javascript:alert(1)"), "javascript:alert(1)");
  });
});
