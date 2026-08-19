import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { affiliateEnabled, withAffiliate } from "./ebay-affiliate";

const ITEM = "https://www.ebay.com/itm/357425252854";
const SEARCH = "https://www.ebay.com/sch/i.html?_nkw=Nendoroid+2534";

afterEach(() => {
  delete process.env.EBAY_CAMPAIGN_ID;
  delete process.env.EBAY_ROTATION_ID;
});

describe("withAffiliate", () => {
  it("leaves links alone until there is a campaign id", () => {
    // The state the site ships in. An untagged link still works.
    assert.equal(withAffiliate(ITEM), ITEM);
    assert.equal(affiliateEnabled(), false);
  });

  it("tags an item link once a campaign id is set", () => {
    process.env.EBAY_CAMPAIGN_ID = "5339000000";
    const url = new URL(withAffiliate(ITEM));
    assert.equal(url.searchParams.get("campid"), "5339000000");
    assert.equal(url.searchParams.get("mkevt"), "1");
    assert.equal(url.searchParams.get("mkcid"), "1");
    assert.equal(url.searchParams.get("toolid"), "10001");
    assert.equal(affiliateEnabled(), true);
  });

  it("keeps the parameters a search already carries", () => {
    process.env.EBAY_CAMPAIGN_ID = "5339000000";
    const url = new URL(withAffiliate(SEARCH));
    assert.equal(url.searchParams.get("_nkw"), "Nendoroid 2534");
    assert.equal(url.searchParams.get("campid"), "5339000000");
  });

  it("only adds a rotation id when one is configured", () => {
    process.env.EBAY_CAMPAIGN_ID = "5339000000";
    assert.equal(new URL(withAffiliate(ITEM)).searchParams.has("mkrid"), false);
    process.env.EBAY_ROTATION_ID = "711-53200-19255-0";
    assert.equal(new URL(withAffiliate(ITEM)).searchParams.get("mkrid"), "711-53200-19255-0");
  });

  it("refuses to tag anything that is not eBay", () => {
    // A campaign id on someone else's domain earns nothing and tells them ours.
    process.env.EBAY_CAMPAIGN_ID = "5339000000";
    const foreign = "https://www.goodsmile.com/en/product/56818";
    assert.equal(withAffiliate(foreign), foreign);
    const lookalike = "https://ebay.com.example.net/itm/1";
    assert.equal(withAffiliate(lookalike), lookalike);
  });

  it("tags eBay's other domains", () => {
    process.env.EBAY_CAMPAIGN_ID = "5339000000";
    assert.match(withAffiliate("https://www.ebay.co.uk/itm/1"), /campid=5339000000/);
  });

  it("passes a custom id through when given one", () => {
    process.env.EBAY_CAMPAIGN_ID = "5339000000";
    assert.equal(
      new URL(withAffiliate(ITEM, "figure-page")).searchParams.get("customid"),
      "figure-page",
    );
  });

  it("returns something unparseable unchanged", () => {
    process.env.EBAY_CAMPAIGN_ID = "5339000000";
    assert.equal(withAffiliate("not a url"), "not a url");
  });
});
