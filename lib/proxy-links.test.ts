import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

/** Re-import with a given env, since ids are read once at module load. */
async function load(env: Record<string, string | undefined> = {}) {
  for (const key of ["PROXY_LINKS_ENABLED", "BUYEE_AFFILIATE_ID", "ZENMARKET_AFFILIATE_ID"]) {
    const value = env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const mod = await import(`./proxy-links?${Math.random()}`);
  return mod as typeof import("./proxy-links");
}

afterEach(() => {
  delete process.env.PROXY_LINKS_ENABLED;
  delete process.env.BUYEE_AFFILIATE_ID;
  delete process.env.ZENMARKET_AFFILIATE_ID;
});

describe("proxySearchQuery", () => {
  it("prefers the Japanese name, which is what sellers write", async () => {
    const { proxySearchQuery } = await load();
    assert.equal(
      proxySearchQuery({ name: "Nendoroid Usada Pekora", nameJa: "ねんどろいど 兎田ぺこら" }),
      "ねんどろいど 兎田ぺこら",
    );
  });

  it("falls back to the English name when there is no Japanese one", async () => {
    const { proxySearchQuery } = await load();
    assert.equal(proxySearchQuery({ name: "figma Touma Kamijou", nameJa: null }), "figma Touma Kamijou");
  });

  it("ignores a Japanese name that is only whitespace", async () => {
    const { proxySearchQuery } = await load();
    assert.equal(proxySearchQuery({ name: "Pop Up Parade Inuyasha", nameJa: "   " }), "Pop Up Parade Inuyasha");
  });
});

describe("proxyLinks", () => {
  it("renders nothing at all until explicitly enabled", async () => {
    const { proxyLinks } = await load();
    assert.deepEqual(proxyLinks({ name: "Nendoroid Hatsune Miku" }), []);
  });

  it("returns both services once enabled", async () => {
    const { proxyLinks } = await load({ PROXY_LINKS_ENABLED: "1" });
    const links = proxyLinks({ name: "Nendoroid Hatsune Miku" });
    assert.deepEqual(
      links.map((l) => l.service),
      ["zenmarket", "buyee"],
    );
  });

  it("percent-encodes a Japanese query rather than emitting raw bytes", async () => {
    const { proxyLinks } = await load({ PROXY_LINKS_ENABLED: "1" });
    const [zen] = proxyLinks({ name: "x", nameJa: "ねんどろいど 初音ミク" });
    assert.ok(zen.url.includes("%E3%81%AD"), zen.url);
    assert.ok(!zen.url.includes(" "), "a raw space would break the link");
  });

  it("escapes a name containing an ampersand instead of splitting the query", async () => {
    const { proxyLinks } = await load({ PROXY_LINKS_ENABLED: "1" });
    const [zen] = proxyLinks({ name: "Fate&Grand Order Saber" });
    const parsed = new URL(zen.url);
    assert.equal(parsed.searchParams.get("q"), "Fate&Grand Order Saber");
  });

  it("drops a figure with no searchable name rather than linking to empty results", async () => {
    const { proxyLinks } = await load({ PROXY_LINKS_ENABLED: "1" });
    assert.deepEqual(proxyLinks({ name: "   ", nameJa: null }), []);
  });
});

describe("affiliate tagging", () => {
  it("omits the parameter entirely when no id is configured", async () => {
    const { proxyLinks } = await load({ PROXY_LINKS_ENABLED: "1" });
    for (const link of proxyLinks({ name: "Nendoroid Saber" })) {
      const parsed = new URL(link.url);
      assert.equal(parsed.searchParams.get("ref"), null);
      assert.equal(parsed.searchParams.get("affiliate"), null);
    }
  });

  it("tags each service with its own id and leaves the other alone", async () => {
    const { proxyLinks } = await load({
      PROXY_LINKS_ENABLED: "1",
      ZENMARKET_AFFILIATE_ID: "zen-123",
    });
    const links = proxyLinks({ name: "Nendoroid Saber" });
    const zen = new URL(links.find((l) => l.service === "zenmarket")!.url);
    const buyee = new URL(links.find((l) => l.service === "buyee")!.url);
    assert.equal(zen.searchParams.get("ref"), "zen-123");
    assert.equal(buyee.searchParams.get("affiliate"), null);
  });

  it("keeps the search keyword when an affiliate id is added", async () => {
    const { proxyLinks } = await load({
      PROXY_LINKS_ENABLED: "1",
      ZENMARKET_AFFILIATE_ID: "zen-123",
    });
    const [zen] = proxyLinks({ name: "x", nameJa: "ねんどろいど 兎田ぺこら" });
    const parsed = new URL(zen.url);
    assert.equal(parsed.searchParams.get("q"), "ねんどろいど 兎田ぺこら");
    assert.equal(parsed.searchParams.get("ref"), "zen-123");
  });
});

describe("all-kana names are names", () => {
  it("uses an all-hiragana product name rather than falling back to English", async () => {
    const { proxySearchQuery } = await load();
    // A real archive name. An earlier guard rejected this shape as a "reading"
    // and fell back to English, which found less.
    assert.equal(
      proxySearchQuery({ name: "Nendoroid Ojisan", nameJa: "ねんどろいど おじさん" }),
      "ねんどろいど おじさん",
    );
  });

  it("uses a name carrying kanji", async () => {
    const { proxySearchQuery } = await load();
    assert.equal(
      proxySearchQuery({ name: "Nendoroid Rin Shima", nameJa: "ねんどろいど 志摩リン" }),
      "ねんどろいど 志摩リン",
    );
  });

  it("uses a katakana-only product name", async () => {
    const { proxySearchQuery } = await load();
    assert.equal(
      proxySearchQuery({ name: "Shea Haulia", nameJa: "シア・ハウリア バニーVer." }),
      "シア・ハウリア バニーVer.",
    );
  });
});
