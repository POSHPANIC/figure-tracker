"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setDisplayCurrency } from "@/lib/actions/preferences";
import { SUPPORTED_CURRENCIES, type CurrencyCode } from "@/lib/currency";
import { cn } from "@/lib/utils";

/**
 * Display-currency picker.
 *
 * Writes a cookie server-side then refreshes, so prices are converted during
 * render rather than in the browser — no flash of the wrong currency, and the
 * choice survives a hard reload.
 */
export function CurrencySwitcher({
  current,
  className,
}: {
  current: CurrencyCode;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <label className={cn("group relative inline-block shrink-0", className)}>
      <span className="sr-only">Display prices in</span>

      {/*
        The real control, invisible and laid over the top. Keeping the native
        select rather than rebuilding it in JavaScript preserves keyboard
        behaviour, screen-reader semantics, and the platform's own picker on
        mobile.

        The colours below are not decorative even though the element is
        transparent: the dropped-open option list is drawn by the browser from
        the select's own computed background and text colour, so without them
        the menu opens in the platform's palette while the page sits in ours.
        `color-scheme` on :root handles the scrollbar and the frame; these
        handle the rows.
      */}
      <select
        value={current}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          startTransition(async () => {
            await setDisplayCurrency(next);
            router.refresh();
          });
        }}
        className="peer absolute inset-0 z-10 h-full w-full cursor-pointer bg-surface text-foreground opacity-0 disabled:cursor-default"
      >
        {SUPPORTED_CURRENCIES.map((c) => (
          <option key={c.code} value={c.code} className="bg-surface text-foreground">
            {/* Room here that the closed state does not have, so say the
                whole name — "CAD" and "AUD" are easy to confuse otherwise. */}
            {c.code} — {c.label}
          </option>
        ))}
      </select>

      {/*
        No flag any more. It was the only saturated thing left on a palette of
        pure greys, and it was carrying no information the three-letter code
        beside it wasn't already carrying. Chrome matched to the theme toggle
        next door, down to the inset hairline and the invert-on-hover, so the
        two read as one pair of controls rather than two widgets.
      */}
      <span
        aria-hidden
        className={cn(
          "flex items-center gap-1.5 border border-border bg-surface px-2 py-1.5 text-xs font-medium",
          "shadow-[inset_0_0_0_1px_var(--background)] transition-colors",
          "peer-hover:border-foreground peer-hover:bg-foreground peer-hover:text-background",
          "peer-focus-visible:border-foreground",
          pending && "opacity-60",
        )}
      >
        {current}
        {/* Opacity rather than a colour, so it stays legible when the whole
            control inverts on hover. */}
        <span className="text-[9px] opacity-60">▼</span>
      </span>
    </label>
  );
}
