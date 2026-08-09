"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertTriangle, Check, ExternalLink, Loader2, X } from "lucide-react";
import { reviewSale } from "@/lib/actions/sales";
import { CONDITION_LABELS } from "@/lib/labels";
import type { ItemCondition } from "@/lib/generated/prisma/enums";
import { formatCurrency, formatUsd } from "@/lib/money";

export type ModerationRowData = {
  id: string;
  condition: ItemCondition;
  amount: string;
  currency: string;
  amountUsd: string;
  soldAt: string;
  url: string | null;
  flagReason: string | null;
  createdAt: string;
  reporter: {
    label: string;
    username: string | null;
    approved: number;
    rejected: number;
  };
  figure: {
    slug: string;
    name: string;
    marketValueUsd: string | null;
    salesVolume90d: number;
  };
};

/**
 * One pending report. Shows the moderator everything needed to judge it without
 * leaving the page: the claimed price against the figure's current market
 * value, why screening flagged it, and the reporter's track record.
 */
export function ModerationRow({ item }: { item: ModerationRowData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function decide(decision: "APPROVED" | "REJECTED") {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("saleId", item.id);
      formData.set("decision", decision);
      if (decision === "REJECTED" && note.trim()) formData.set("note", note.trim());

      const result = await reviewSale(formData);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  const market = item.figure.marketValueUsd;
  const claimed = Number(item.amountUsd);
  const ratio = market ? claimed / Number(market) : null;

  return (
    <li className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/figures/${item.figure.slug}`}
            target="_blank"
            className="text-sm font-medium hover:text-accent"
          >
            {item.figure.name}
          </Link>
          <p className="mt-0.5 text-xs text-muted">
            {CONDITION_LABELS[item.condition]} · sold{" "}
            {new Date(item.soldAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}{" "}
            · reported{" "}
            {new Date(item.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </p>
        </div>

        <div className="text-right">
          <p className="tabular text-lg font-semibold">{formatUsd(item.amountUsd)}</p>
          {item.currency !== "USD" && (
            <p className="tabular text-xs text-muted">
              {formatCurrency(item.amount, item.currency)}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <Cell label="Current market value">
          {market ? formatUsd(market) : "no data"}
          {ratio !== null && (
            <span className="ml-1.5 text-xs text-muted">({ratio.toFixed(1)}×)</span>
          )}
        </Cell>
        <Cell label="Sales on record (90d)">{item.figure.salesVolume90d}</Cell>
        <Cell label="Reporter">
          {item.reporter.username ? (
            <Link
              href={`/u/${item.reporter.username}`}
              target="_blank"
              className="hover:text-accent"
            >
              {item.reporter.label}
            </Link>
          ) : (
            item.reporter.label
          )}
          <span className="ml-1.5 text-xs text-muted">
            {item.reporter.approved} ok / {item.reporter.rejected} rejected
          </span>
        </Cell>
      </div>

      {item.flagReason && (
        <p className="mt-3 flex gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs leading-snug text-muted">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          {item.flagReason}
        </p>
      )}

      {item.url && (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="mt-2 inline-flex items-center gap-1 text-xs text-accent hover:underline"
        >
          <ExternalLink className="size-3" /> Listing supplied by the reporter
        </a>
      )}

      {rejecting && (
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={300}
          placeholder="Reason (shown to the reporter) — optional"
          className="mt-3 w-full rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-sm outline-none focus:border-accent"
        />
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => decide("APPROVED")}
          disabled={pending}
          className="flex items-center gap-1.5 rounded-lg bg-up px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Approve
        </button>

        {rejecting ? (
          <>
            <button
              type="button"
              onClick={() => decide("REJECTED")}
              disabled={pending}
              className="flex items-center gap-1.5 rounded-lg bg-down px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
            >
              <X className="size-4" /> Confirm reject
            </button>
            <button
              type="button"
              onClick={() => setRejecting(false)}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted transition hover:text-foreground"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setRejecting(true)}
            disabled={pending}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition hover:border-down/60 hover:text-down disabled:opacity-60"
          >
            <X className="size-4" /> Reject
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-down">{error}</p>}
    </li>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border px-2.5 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-muted">{label}</p>
      <p className="tabular mt-0.5 text-sm">{children}</p>
    </div>
  );
}
