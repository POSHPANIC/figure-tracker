"use client";

import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import {
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  themeAttribute,
  type Theme,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * Light/dark toggle.
 *
 * Unlike the currency switcher next to it, this does not round-trip to the
 * server. Currency has to, because prices are converted during render; a
 * palette is entirely client-side, and making someone wait for a server
 * response to change the colour of the page would be the slowest possible way
 * to do the fastest possible thing.
 *
 * So the click does two independent jobs:
 *
 *   1. Sets the attribute on <html>, which repaints immediately.
 *   2. Writes the cookie, so the *next* server render already agrees and the
 *      page never loads in the wrong palette and corrects itself.
 *
 * Writing the cookie from script rather than through a server action is what
 * keeps those two in step — there is no window where the attribute has changed
 * but the cookie hasn't landed yet.
 */
export function ThemeSwitcher({
  current,
  className,
}: {
  current: Theme;
  className?: string;
}) {
  // Seeded from the server-rendered value, so the first client render matches
  // the markup and there is nothing to reconcile.
  const [theme, setTheme] = useState<Theme>(current);
  const next: Theme = theme === "dark" ? "light" : "dark";

  function toggle() {
    const attr = themeAttribute(next);
    if (attr) document.documentElement.setAttribute("data-theme", attr);
    else document.documentElement.removeAttribute("data-theme");

    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      // The control is an icon, so the label has to carry the whole meaning —
      // and it names the outcome rather than the current state, because that is
      // what pressing it does.
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={cn(
        "flex shrink-0 items-center justify-center border border-border bg-surface p-1.5",
        "shadow-[inset_0_0_0_1px_var(--background)] transition-colors",
        "hover:border-foreground hover:bg-foreground hover:text-background",
        className,
      )}
    >
      {/* Shows where the button goes, not where you are. */}
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
