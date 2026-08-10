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
    <label className={cn("relative shrink-0", className)}>
      <span className="sr-only">Display prices in</span>
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
        className={cn(
          "cursor-pointer appearance-none rounded-lg border border-border bg-surface py-1.5 pl-2.5 pr-6 text-xs font-medium outline-none transition hover:border-accent/60 focus:border-accent",
          pending && "opacity-60",
        )}
      >
        {SUPPORTED_CURRENCIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code}
          </option>
        ))}
      </select>
      <span
        aria-hidden
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-muted"
      >
        ▼
      </span>
    </label>
  );
}
