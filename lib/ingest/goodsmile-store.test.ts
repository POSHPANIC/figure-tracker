import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyResponse, describeAvailability, parseStorePage } from "./goodsmile-store";

/** Trimmed from the live page for product 56818, the FREEing Usada Pekora. */
const PEKORA = `
  <script>dataLayer.push({"event":"view_item","ecommerce":{"currency":"JPY","items":[{"item_id":"56818","item_name":"Usada Pekora","item_brand":"FREEing","price":44000,"item_category":"Figure","item_category2":"Scale Figure","item_category3":"1/4th Scale"}],"value":44000}});</script>
  <div class="detail">Preorder Period: 2024/01/12~2024/03/06 (JST) Shipping 2024/08・Limit 3 per person</div>
`;

describe("parseStorePage", () => {
  it("reads the product out of their own analytics payload", () => {
    const p = parseStorePage(PEKORA, new Date("2026-08-19T00:00:00Z"));
    assert.equal(p?.productId, "56818");
    assert.equal(p?.name, "Usada Pekora");
    assert.equal(p?.priceJpy, 44000);
    assert.equal(p?.brand, "FREEing");
  });

  it("closes ordering once the stated window has passed", () => {
    const p = parseStorePage(PEKORA, new Date("2026-08-19T00:00:00Z"));
    assert.equal(p?.available, false);
    assert.equal(p?.orderClosesAt?.toISOString().slice(0, 10), "2024-03-06");
    assert.equal(describeAvailability(p!), "Ordering closed 6 Mar 2024");
  });

  it("keeps ordering open while the window is still running", () => {
    // The same page read during the window, which is the case that matters for
    // anything currently on sale.
    const p = parseStorePage(PEKORA, new Date("2024-02-01T00:00:00Z"));
    assert.equal(p?.available, true);
    assert.equal(describeAvailability(p!), "Available to order");
  });

  it("includes the last day of the window", () => {
    // A window closing on the 6th is open on the 6th, in Japan.
    const p = parseStorePage(PEKORA, new Date("2024-03-06T12:00:00Z"));
    assert.equal(p?.available, true);
  });

  it("says nothing rather than no when the page states no window", () => {
    // "We could not tell" and "you cannot buy it" are different, and telling
    // someone the second when we mean the first costs them a purchase.
    const noWindow = PEKORA.replace(/Preorder Period[^<]*/, "");
    const p = parseStorePage(noWindow, new Date());
    assert.equal(p?.available, null);
    assert.equal(describeAvailability(p!), "Availability not stated");
  });

  it("says unavailable when a store says no without naming a date", () => {
    // Shopify's `available` flag is a plain no with no window attached. That is
    // a different thing from "we could not tell", and reads differently.
    assert.equal(
      describeAvailability({ orderClosesAt: null, available: false }),
      "Currently unavailable",
    );
  });

  it("returns nothing for a page with no product on it", () => {
    assert.equal(parseStorePage("<html><body>404</body></html>"), null);
    assert.equal(parseStorePage(""), null);
  });

  it("survives a payload that is not valid JSON", () => {
    const broken = `dataLayer.push({"event":"view_item","ecommerce":{"items":[{"item_id":oops}]`;
    assert.equal(parseStorePage(broken), null);
  });
});

describe("classifyResponse", () => {
  const product = "https://www.goodsmile.com/en/product/56818/Usada+Pekora";

  it("treats a 404 as withdrawn", () => {
    assert.equal(classifyResponse({ status: 404, finalUrl: product, hasProduct: false }).state, "gone");
    assert.equal(classifyResponse({ status: 410, finalUrl: product, hasProduct: false }).state, "gone");
  });

  it("treats a redirect off the product page as withdrawn", () => {
    // The failure that sank the first attempt at these links: a dead product
    // redirects to the storefront, which answers a perfectly healthy 200.
    const v = classifyResponse({ status: 200, finalUrl: "https://www.goodsmile.com/en", hasProduct: false });
    assert.equal(v.state, "gone");
  });

  it("leaves the link alone when the store is merely unwell", () => {
    for (const status of [0, 500, 502, 503, 429]) {
      assert.equal(
        classifyResponse({ status, finalUrl: product, hasProduct: false }).state,
        "transient",
        `status ${status}`,
      );
    }
  });

  it("does not delete links because the page format changed", () => {
    // Still a product URL, still 200, but nothing parsed. Far likelier that
    // they redesigned than that the product vanished — and acting on it would
    // clear every link we hold in a single run.
    const v = classifyResponse({ status: 200, finalUrl: product, hasProduct: false });
    assert.equal(v.state, "transient");
  });

  it("passes a product page that parsed", () => {
    assert.equal(classifyResponse({ status: 200, finalUrl: product, hasProduct: true }).state, "ok");
  });
});
