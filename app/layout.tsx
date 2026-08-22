import type { Metadata } from "next";
import localFont from "next/font/local";
import { AuthProvider } from "@/components/session-provider";
import { THEME_SCRIPT } from "@/lib/theme";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from "@/lib/site";
import { SiteFooter, SiteHeader } from "@/components/site-header";
import "./globals.css";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * Three faces, three jobs.
 *
 * Marcellus is the inscriptional flat serif that headings and the wordmark are
 * set in — letterspaced and uppercase it carries the engraved, menu-like weight
 * the headings want. Plex Mono runs the entire chrome: labels, controls,
 * prices, status strips. Plex Serif is held back for the prose pages, which are
 * read rather than scanned and shouldn't be monospaced.
 *
 * Vendored rather than pulled through `next/font/google`. Both families are
 * OFL, and self-hosting means neither a build nor a cold dev start depends on
 * reaching fonts.gstatic.com — which is a real failure mode, not a theoretical
 * one. The files are the latin woff2 subsets Google serves, so the bytes on the
 * wire are the same either way.
 */
const display = localFont({
  src: [{ path: "./fonts/marcellus-400.woff2", weight: "400", style: "normal" }],
  display: "swap",
  variable: "--font-display-face",
});

const mono = localFont({
  src: [
    { path: "./fonts/plex-mono-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/plex-mono-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/plex-mono-600.woff2", weight: "600", style: "normal" },
  ],
  display: "swap",
  variable: "--font-mono-face",
});

const serif = localFont({
  src: [
    { path: "./fonts/plex-serif-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/plex-serif-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/plex-serif-600.woff2", weight: "600", style: "normal" },
  ],
  display: "swap",
  variable: "--font-serif-face",
});

export const metadata: Metadata = {
  title: {
    default: `${SITE_NAME} — ${SITE_TAGLINE}`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // The theme is applied by a script in <head> rather than read from the cookie
  // here. Reading it here made this layout — and therefore every route beneath
  // it — impossible to prerender, which is what put 280,000 uncached renders a
  // month on the meter. The script runs before the first paint, so the markup
  // still arrives the right colour. See lib/theme.ts.
  return (
    <html
      lang="en"
      className={`${display.variable} ${mono.variable} ${serif.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        {/*
          The boot sequence is parked, not deleted. To bring it back, restore
          these three things together — the overlay is opaque and server-
          rendered, so the <noscript> guard is not optional: without it, a
          visitor with JavaScript disabled gets a black screen and no way past.

            import { BootSequence } from "@/components/boot-sequence";

            <noscript>
              <style>{`.boot-overlay{display:none}`}</style>
            </noscript>
            <BootSequence />

          Its styles are still in globals.css and the component still compiles;
          nothing imports it, so it is tree-shaken out of the bundle.
        */}

        {/*
          The CRT stack. Fixed, pointer-events-none, above the page and below
          the cursor — three elements for the whole site rather than a texture
          on every panel. Ordered back to front: vignette darkens the corners,
          scanlines rule the tube, grain sits on the glass.
        */}
        <div aria-hidden className="crt-vignette" />
        <div aria-hidden className="crt-scanlines" />
        <div aria-hidden className="crt-grain" />

        <AuthProvider>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </AuthProvider>
      </body>
    </html>
  );
}
