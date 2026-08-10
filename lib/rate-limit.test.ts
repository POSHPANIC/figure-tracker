import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LIMITS, clientIp, rateLimitHeaders, windowStartFor } from "./rate-limit";

/**
 * The database-backed counting is exercised by an integration check rather than
 * here; what's unit tested is the arithmetic and header parsing around it,
 * which is where the quiet mistakes live — an off-by-one in window alignment
 * makes limits drift, and trusting the wrong header hands an attacker a trivial
 * bypass.
 */

const MINUTE = 60_000;

describe("windowStartFor", () => {
  it("aligns to the start of the window", () => {
    const t = Date.parse("2026-08-10T12:34:56.789Z");
    const start = windowStartFor(t, MINUTE);
    assert.equal(start.toISOString(), "2026-08-10T12:34:00.000Z");
  });

  it("gives the same window for any instant inside it", () => {
    const a = windowStartFor(Date.parse("2026-08-10T12:34:00.000Z"), MINUTE);
    const b = windowStartFor(Date.parse("2026-08-10T12:34:59.999Z"), MINUTE);
    assert.equal(a.getTime(), b.getTime());
  });

  it("rolls over at the boundary", () => {
    const a = windowStartFor(Date.parse("2026-08-10T12:34:59.999Z"), MINUTE);
    const b = windowStartFor(Date.parse("2026-08-10T12:35:00.000Z"), MINUTE);
    assert.equal(b.getTime() - a.getTime(), MINUTE);
  });

  it("handles windows other than a minute", () => {
    const t = Date.parse("2026-08-10T12:34:56.000Z");
    assert.equal(
      windowStartFor(t, 3600_000).toISOString(),
      "2026-08-10T12:00:00.000Z",
    );
  });
});

describe("clientIp", () => {
  it("takes the first entry of x-forwarded-for", () => {
    // Vercel puts the real client first and appends proxies after it.
    const headers = new Headers({ "x-forwarded-for": "203.0.113.4, 70.41.3.18, 150.172.238.178" });
    assert.equal(clientIp(headers), "203.0.113.4");
  });

  it("trims whitespace", () => {
    assert.equal(clientIp(new Headers({ "x-forwarded-for": "  203.0.113.4  " })), "203.0.113.4");
  });

  it("falls back to x-real-ip", () => {
    assert.equal(clientIp(new Headers({ "x-real-ip": "198.51.100.7" })), "198.51.100.7");
  });

  it("prefers x-forwarded-for over x-real-ip", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.4",
      "x-real-ip": "198.51.100.7",
    });
    assert.equal(clientIp(headers), "203.0.113.4");
  });

  it("returns a stable placeholder when nothing identifies the caller", () => {
    // Everyone anonymous shares one bucket, which is deliberate: better that
    // unidentifiable traffic is limited collectively than not at all.
    assert.equal(clientIp(new Headers()), "unknown");
  });

  it("does not fall over on an empty header", () => {
    assert.equal(clientIp(new Headers({ "x-forwarded-for": "" })), "unknown");
  });
});

describe("rateLimitHeaders", () => {
  const resetAt = new Date("2026-08-10T12:35:00.000Z");

  it("reports the limit and what's left", () => {
    const headers = rateLimitHeaders(
      { allowed: true, remaining: 42, resetAt, retryAfterSeconds: 30 },
      60,
    );
    assert.equal(headers["RateLimit-Limit"], "60");
    assert.equal(headers["RateLimit-Remaining"], "42");
    assert.equal(headers["RateLimit-Reset"], String(Math.ceil(resetAt.getTime() / 1000)));
  });

  it("omits Retry-After while the request is still allowed", () => {
    const headers = rateLimitHeaders(
      { allowed: true, remaining: 1, resetAt, retryAfterSeconds: 30 },
      60,
    );
    assert.equal("Retry-After" in headers, false);
  });

  it("sets Retry-After once blocked", () => {
    const headers = rateLimitHeaders(
      { allowed: false, remaining: 0, resetAt, retryAfterSeconds: 30 },
      60,
    );
    assert.equal(headers["Retry-After"], "30");
  });
});

describe("configured limits", () => {
  it("gives search enough headroom for typeahead", () => {
    // The search box fires per keystroke after a debounce; a limit below ~30
    // would break normal typing rather than abuse.
    assert.ok(LIMITS.search.limit >= 30);
    assert.equal(LIMITS.search.windowMs, 60_000);
  });

  it("keeps sign-in attempts tighter than search", () => {
    assert.ok(LIMITS.auth.limit < LIMITS.search.limit);
  });
});
