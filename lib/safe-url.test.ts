import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSafeHttpUrl, safeHttpUrl } from "./safe-url";

describe("safeHttpUrl", () => {
  it("refuses the schemes that execute", () => {
    // Zod's .url() accepts every one of these — it asks whether the string is a
    // URL, not whether it belongs in an href.
    assert.equal(safeHttpUrl("javascript:alert(1)"), null);
    assert.equal(safeHttpUrl("data:text/html,<script>alert(1)</script>"), null);
    assert.equal(safeHttpUrl("vbscript:msgbox(1)"), null);
    assert.equal(safeHttpUrl("  JavaScript:alert(1)  "), null);
  });

  it("refuses schemes that are not links to a page", () => {
    assert.equal(safeHttpUrl("file:///etc/passwd"), null);
    assert.equal(safeHttpUrl("mailto:someone@example.com"), null);
  });

  it("keeps ordinary links", () => {
    assert.equal(safeHttpUrl("https://solarisjapan.com/products/x"), "https://solarisjapan.com/products/x");
    assert.equal(safeHttpUrl("http://example.com/a?b=c"), "http://example.com/a?b=c");
  });

  it("handles nothing at all", () => {
    assert.equal(safeHttpUrl(null), null);
    assert.equal(safeHttpUrl(""), null);
    assert.equal(safeHttpUrl("not a url"), null);
    assert.equal(isSafeHttpUrl("https://example.com"), true);
    assert.equal(isSafeHttpUrl("javascript:void 0"), false);
  });
});
