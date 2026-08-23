/**
 * Links that came from somebody else.
 *
 * `new URL()` parses "javascript:alert(1)" quite happily, and so does Zod's
 * `.url()` — it only asks whether the string is a URL, not whether it is one
 * you should put in an href. Rendered as a link, that executes in the clicker's
 * session.
 *
 * Two places had the gap. A correction form takes a store link from anyone at
 * all, unvalidated beyond its length, and the moderation queue renders it as a
 * link for a moderator to click — which is precisely their job. And an image's
 * source credit, moderator-supplied, is rendered on the public figure page.
 *
 * So: http and https only, checked when it is stored and again when it is
 * rendered. The second check is not redundant. Rows written before this existed
 * are still in the database, and a validator only guards what comes after it.
 */

/** The URL if it is safe to put in an href, otherwise null. */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
}

/** Whether a string is a URL we would render. For validating input. */
export function isSafeHttpUrl(url: string | null | undefined): boolean {
  return safeHttpUrl(url) !== null;
}
