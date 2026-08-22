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
