import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Cache Components — Partial Prerendering plus the `use cache` directive.
   *
   * Turned on because nothing was cached at all. Vercel measured 280,000
   * function invocations in thirty days against zero ISR reads: every request,
   * including every crawler walking all 7,387 figure pages, ran a full render
   * and its queries. That is what consumed three of the four hours of Active
   * CPU the free tier allows, and the project pauses at four.
   *
   * The pages are not dynamic because they show anything personal. They are
   * dynamic because getDisplayMoney reads a cookie to pick a display currency,
   * which makes the whole route dynamic even for a request that has no cookies.
   * Prerendering the shell and streaming only the parts that genuinely vary
   * moves that traffic onto ISR reads, a quota sitting entirely unused.
   */
  cacheComponents: true,
};

export default nextConfig;
