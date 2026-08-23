import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

async function load(key?: string) {
  if (key === undefined) delete process.env.SOVRN_API_KEY;
  else process.env.SOVRN_API_KEY = key;
  return (await import(`./sovrn?${Math.random()}`)) as typeof import("./sovrn");
}

afterEach(() => {
  delete process.env.SOVRN_API_KEY;
});

describe("withSovrn", () => {
  it("leaves the link alone when no key is configured", async () => {
    const { withSovrn, sovrnEnabled } = await load();
    assert.equal(sovrnEnabled(), false);
    assert.equal(withSovrn("https://www.amiami.com/eng/"), "https://www.amiami.com/eng/");
  });

  it("wraps through the documented endpoint", async () => {
    const { withSovrn } = await load("abc123");
    const wrapped = new URL(withSovrn("https://www.amiami.com/eng/search/list/?s_keywords=x"));
    assert.equal(wrapped.origin + wrapped.pathname, "https://redirect.viglink.com/");
    assert.equal(wrapped.searchParams.get("key"), "abc123");
    assert.equal(
      wrapped.searchParams.get("u"),
      "https://www.amiami.com/eng/search/list/?s_keywords=x",
    );
  });

  it("keeps the destination readable when it carries its own query", async () => {
    // The whole URL goes in one parameter, so its ? and & must survive.
    const { withSovrn } = await load("k");
    const target = "https://shop.example/search?q=a+b&page=2";
    assert.equal(new URL(withSovrn(target)).searchParams.get("u"), target);
  });

  it("carries a cuid when given one", async () => {
    const { withSovrn } = await load("k");
    assert.equal(
      new URL(withSovrn("https://shop.example/", "figure-page")).searchParams.get("cuid"),
      "figure-page",
    );
  });

  it("refuses to wrap anything that is not an http link", async () => {
    const { withSovrn } = await load("k");
    assert.equal(withSovrn("javascript:alert(1)"), "javascript:alert(1)");
    assert.equal(withSovrn("not a url"), "not a url");
  });
});

describe("amiamiSearchUrl", () => {
  it("builds a search for the figure's name", async () => {
    const { amiamiSearchUrl } = await load();
    assert.equal(
      amiamiSearchUrl("Nendoroid Marin Kitagawa"),
      "https://www.amiami.com/eng/search/list/?s_keywords=Nendoroid%20Marin%20Kitagawa",
    );
  });

  it("returns null rather than a link to an empty search", async () => {
    const { amiamiSearchUrl } = await load();
    assert.equal(amiamiSearchUrl("   "), null);
  });
});
