"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { removeFromCollection } from "@/lib/actions/collection";
import { CONDITION_LABELS } from "@/lib/labels";
import type { ItemCondition } from "@/lib/generated/prisma/enums";
import { formatCurrency, toNumber } from "@/lib/money";
import { formatMoney, type DisplayMoney } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { FigureThumb } from "./figure-thumb";

export type CollectionRowData = {
  id: string;
  quantity: number;
  condition: ItemCondition;
  paidAmount: string | null;
  paidCurrency: string | null;
  paidAmountUsd: string | null;
  purchasedAt: string | null;
  figure: {
    slug: string;
    name: string;
    primaryImageUrl: string | null;
    seriesName: string | null;
    manufacturerName: string | null;
    marketValueUsd: string | null;
  };
};

export function CollectionRow({
  item,
  money,
}: {
  item: CollectionRowData;
  money: DisplayMoney;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = toNumber(item.figure.marketValueUsd);
  const paid = toNumber(item.paidAmountUsd);
  const lineValue = value === null ? null : value * item.quantity;
  const linePaid = paid === null ? null : paid * item.quantity;
  const gain = lineValue !== null && linePaid !== null ? lineValue - linePaid : null;

  function remove() {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("itemId", item.id);
      const result = await removeFromCollection(formData);
      if (result.ok) router.refresh();
      else {
        setError(result.error);
        setConfirming(false);
      }
    });
  }

  return (
    <li className="rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center gap-3">
        <Link
          href={`/figures/${item.figure.slug}`}
          className="size-14 shrink-0 overflow-hidden rounded-lg bg-surface-2"
        >
          <FigureThumb
            name={item.figure.name}
            slug={item.figure.slug}
            src={item.figure.primaryImageUrl}
          />
        </Link>

        <div className="min-w-0 flex-1">
          <Link
            href={`/figures/${item.figure.slug}`}
            className="block truncate text-sm font-medium hover:text-accent"
          >
            {item.figure.name}
          </Link>
          <p className="truncate text-xs text-muted">
            {item.figure.seriesName} · {item.figure.manufacturerName}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            <span className="tabular">{item.quantity}×</span>{" "}
            {CONDITION_LABELS[item.condition].toLowerCase()}
            {item.paidAmount && item.paidCurrency && (
              <> · paid {formatCurrency(item.paidAmount, item.paidCurrency)}</>
            )}
            {item.purchasedAt && (
              <>
                {" "}
                ·{" "}
                {new Date(item.purchasedAt).toLocaleDateString("en-US", {
                  month: "short",
                  year: "numeric",
                })}
              </>
            )}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="tabular text-sm font-semibold">{formatMoney(lineValue, money)}</p>
          {gain !== null && (
            <p
              className={cn(
                "tabular text-xs",
                gain > 0 ? "text-up" : gain < 0 ? "text-down" : "text-muted",
              )}
            >
              {gain > 0 ? "+" : ""}
              {formatMoney(gain, money)}
            </p>
          )}
        </div>

        {confirming ? (
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="rounded-md bg-down px-2 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : "Remove"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border border-border px-2 py-1.5 text-xs text-muted transition hover:text-foreground"
            >
              Keep
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label={`Remove ${item.figure.name} from collection`}
            className="shrink-0 rounded-md border border-border p-1.5 text-muted transition hover:border-down/60 hover:text-down"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-down">{error}</p>}
    </li>
  );
}
