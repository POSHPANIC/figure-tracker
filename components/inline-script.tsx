/**
 * A script that runs while the browser parses the HTML, before first paint.
 *
 * The only way to correct server-rendered markup against client-only state
 * (sessionStorage, media queries) without the user seeing the uncorrected
 * version first — `useEffect` and even `useLayoutEffect` both run after the
 * server HTML has already been painted.
 *
 * The `type` swap is not decorative: React warns in development whenever a
 * render produces a `<script>` tag, and on client-side navigation the script
 * would be inserted via the DOM, where it would not execute anyway. Marking it
 * `text/plain` on the client makes that explicit rather than accidental, and
 * `suppressHydrationWarning` covers the resulting type mismatch.
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
