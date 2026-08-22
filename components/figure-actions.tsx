"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Heart, Loader2, Plus, X } from "lucide-react";
import { addToCollection, toggleWishlist } from "@/lib/actions/collection";
import { CONDITION_LABELS } from "@/lib/labels";
import type { ItemCondition } from "@/lib/generated/prisma/enums";
import { formatCurrency } from "@/lib/money";
import { cn } from "@/lib/utils";
import { SITE_NAME } from "@/lib/site";

type OwnedItem = {
  id: string;
  quantity: number;
  condition: ItemCondition;
  paidAmount: string | null;
  paidCurrency: string | null;
};

type Props = {
  figureId: string;
  /** Null when signed out — buttons then send you to sign-in. */
  signedIn: boolean;
  owned: OwnedItem[];
  onWishlist: boolean;
};

const CONDITION_OPTIONS: ItemCondition[] = [
  "NEW_SEALED",
  "NEW_OPENED",
  "USED_COMPLETE",
  "USED_INCOMPLETE",
  "DAMAGED",
];

const CURRENCIES = ["USD", "JPY", "EUR", "GBP", "CAD", "AUD"];

export function FigureActions({ figureId, signedIn, owned, onWishlist }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [wishPending, startWishTransition] = useTransition();

  function requireSignIn() {
    router.push(`/signin?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
  }

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await addToCollection(formData);
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function wishlist() {
    if (!signedIn) return requireSignIn();
    setError(null);
    startWishTransition(async () => {
      const formData = new FormData();
      formData.set("figureId", figureId);
      const result = await toggleWishlist(formData);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => (signedIn ? setOpen((v) => !v) : requireSignIn())}
          className="flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background transition hover:opacity-90"
        >
          {open ? <X className="size-4" /> : <Plus className="size-4" />}
          {open ? "Cancel" : owned.length > 0 ? "Add another" : "Add to collection"}
        </button>

        <button
          type="button"
          onClick={wishlist}
          disabled={wishPending}
          aria-pressed={onWishlist}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition disabled:opacity-60",
            onWishlist
              ? "border-foreground bg-foreground text-background"
              : "border-border bg-surface hover:border-foreground",
          )}
        >
          {wishPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Heart className={cn("size-4", onWishlist && "fill-current")} />
          )}
          {onWishlist ? "On wishlist" : "Wishlist"}
        </button>
      </div>

      {owned.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {owned.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs"
            >
              <Check className="size-3.5 shrink-0 text-up" />
              <span>
                You own <span className="tabular font-medium">{item.quantity}×</span>{" "}
                {CONDITION_LABELS[item.condition].toLowerCase()}
              </span>
              {item.paidAmount && item.paidCurrency && (
                <span className="tabular ml-auto text-muted">
                  paid {formatCurrency(item.paidAmount, item.paidCurrency)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="mt-2 rounded-lg border border-down/40 bg-down/10 px-2.5 py-1.5 text-xs text-down">
          {error}
        </p>
      )}

      {open && (
        <form action={submit} className="mt-3 space-y-3 rounded-xl border border-border bg-surface p-3">
          <input type="hidden" name="figureId" value={figureId} />

          <div className="grid grid-cols-2 gap-2">
            <Field label="Condition">
              <select
                name="condition"
                defaultValue="NEW_SEALED"
                className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none focus:border-foreground"
              >
                {CONDITION_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {CONDITION_LABELS[c]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Quantity">
              <input
                type="number"
                name="quantity"
                min={1}
                max={999}
                defaultValue={1}
                className="tabular w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none focus:border-foreground"
              />
            </Field>
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Field label="What you paid (optional)">
              <input
                type="number"
                name="paidAmount"
                min={0}
                step="0.01"
                placeholder="—"
                className="tabular w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none focus:border-foreground"
              />
            </Field>
            <Field label="Currency">
              <select
                name="paidCurrency"
                defaultValue="USD"
                className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none focus:border-foreground"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Purchase date (optional)">
            <input
              type="date"
              name="purchasedAt"
              className="w-full rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none focus:border-foreground"
            />
          </Field>

          <button
            type="submit"
            disabled={pending}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60"
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            Save to collection
          </button>

          <p className="text-[11px] leading-tight text-muted">
            Recording what you paid lets {SITE_NAME} show profit and loss. It's private —
            never shown on your public profile.
          </p>
        </form>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}
