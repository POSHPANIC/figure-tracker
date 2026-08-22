/**
 * Light/dark preference.
 *
 * Kept in a cookie rather than the database or localStorage, for the same
 * reason the display currency is: most visitors to a price reference never make
 * an account, and a cookie is the only one of the three the server can read
 * while rendering. That matters here — the palette has to be correct in the
 * first byte of HTML, because a theme corrected after paint is a visible flash
 * on every single page load.
 *
 * Shared by client and server, so nothing in this file may import
 * `next/headers`.
 */

export const THEME_COOKIE = "theme";

/** A year. It's a preference, not a session. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type Theme = "light" | "dark";

/**
 * Light, always — the OS `prefers-color-scheme` setting is deliberately not
 * consulted. Someone who wants dark has to ask for it with the toggle.
 */
export const DEFAULT_THEME: Theme = "light";

/**
 * Anything that isn't exactly "dark" resolves to light, so a truncated,
 * hand-edited or stale cookie degrades to the default rather than to a broken
 * palette.
 */
export function parseTheme(value: string | undefined | null): Theme {
  return value === "dark" ? "dark" : DEFAULT_THEME;
}

/** The document attribute the palette in globals.css keys off. */
export function themeAttribute(theme: Theme): Theme | undefined {
  // Light is the bare `:root` rule, so it wants no attribute at all rather than
  // `data-theme="light"` — one source of truth for "this is the default".
  return theme === "dark" ? "dark" : undefined;
}

/**
 * The pre-paint theme script, inlined into <head>.
 *
 * The palette has to be right in the first byte the browser paints, and this
 * used to be done by reading the cookie during the server render. That worked,
 * but a cookie read in the root layout makes *every* route in the app dynamic —
 * which is how the site came to run 280,000 uncached function invocations in a
 * month and spend three of its four allowed CPU-hours re-rendering pages for
 * crawlers.
 *
 * A synchronous script in <head> runs before the first paint, so there is still
 * no flash, and the layout it replaces can now be prerendered. Light is the
 * default and carries no attribute, so this only ever has to add one.
 *
 * Deliberately not a module: it must execute before anything else, and it must
 * not depend on hydration having happened.
 */
export const THEME_SCRIPT = `try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=([^;]*)/);if(m&&decodeURIComponent(m[1])==="dark"){document.documentElement.dataset.theme="dark"}}catch(e){}`;
