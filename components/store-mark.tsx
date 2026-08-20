import { GoodSmileMark } from "./goodsmile-mark";

/**
 * The wordmark for whichever store a product link points at.
 *
 * Every mark here is set as text rather than traced from the company's
 * artwork, for the reasons in goodsmile-mark.tsx: it is a recognisable
 * attribution built from a font, it cannot go subtly stale when they refresh
 * their branding, and it is not a copy of a logo we have no licence to
 * reproduce.
 *
 * A store we have no mark for falls back to its own hostname, which is honest
 * and needs no maintenance — better a plain "amiami.com" than a guessed
 * approximation of somebody's brand.
 */

function KotobukiyaMark({ className = "" }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Kotobukiya"
      className={`inline-flex select-none items-baseline font-semibold uppercase leading-none tracking-[0.12em] ${className}`}
    >
      <span aria-hidden="true">Koto</span>
      <span aria-hidden="true" className="text-accent">
        bukiya
      </span>
    </span>
  );
}

/** The bare hostname, for a store with no mark of its own here yet. */
function HostMark({ url, className = "" }: { url: string; className?: string }) {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  return (
    <span className={`inline-flex select-none items-baseline font-medium leading-none ${className}`}>
      {host}
    </span>
  );
}

export function StoreMark({ url, className = "" }: { url: string; className?: string }) {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }

  // Matched on the registrable host, not with `includes`, so a URL that merely
  // contains a store's name somewhere in it cannot borrow their mark.
  if (host === "goodsmile.com" || host.endsWith(".goodsmile.com")) {
    return <GoodSmileMark className={className} />;
  }
  if (host === "kotobukiya-us.com" || host.endsWith(".kotobukiya-us.com")) {
    return <KotobukiyaMark className={className} />;
  }
  return <HostMark url={url} className={className} />;
}
