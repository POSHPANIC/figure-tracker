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

  /**
   * One address for the site: www.figureindex.com goes to figureindex.com.
   *
   * www was serving the whole site in its own right, and that broke signing
   * in. Starting from www, Auth.js set its PKCE cookie on www, then Discord
   * sent the browser back to figureindex.com -- the one callback URL Discord
   * knows -- where that cookie does not exist, and the check failed as an
   * unexplained "Configuration" error. It also published every page twice.
   *
   * A config redirect rather than proxy.ts: it is matched before anything
   * renders, and a host-to-host rule needs no code.
   */
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.figureindex.com" }],
        destination: "https://figureindex.com/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
