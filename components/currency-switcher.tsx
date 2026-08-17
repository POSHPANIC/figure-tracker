"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { CurrencyFlag } from "@/components/currency-flag";
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
        The real control, invisible and laid over the top. An <option> renders
        text and nothing else — no images, no SVG — so a flag can only appear
        in the closed state, which means drawing that part ourselves. Keeping
        the native select underneath rather than rebuilding it in JavaScript
        preserves keyboard behaviour, screen-reader semantics, and the
        platform's own picker on mobile.
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
        className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
      >
        {SUPPORTED_CURRENCIES.map((c) => (
          <option key={c.code} value={c.code}>
            {/* Room here that the closed state does not have, so say the
                whole name — "CAD" and "AUD" are easy to confuse otherwise. */}
            {c.code} — {c.label}
          </option>
        ))}
      </select>

      <span
        aria-hidden
        className={cn(
          "flex items-center gap-1.5 rounded-lg border border-border bg-surface py-1.5 pl-2 pr-2 text-xs font-medium transition",
          "peer-hover:border-accent/60 peer-focus-visible:border-accent",
          pending && "opacity-60",
        )}
      >
        <CurrencyFlag code={current} className="h-[11px] w-[16px]" />
        {current}
        <span className="text-[9px] text-muted">▼</span>
      </span>
    </label>
  );
}
