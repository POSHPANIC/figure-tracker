"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2, Clock, Loader2, Trash2, XCircle } from "lucide-react";
import { deleteMyReport } from "@/lib/actions/sales";
import { CONDITION_LABELS } from "@/lib/labels";
import type { ItemCondition, SaleStatus } from "@/lib/generated/prisma/enums";
import { formatCurrency } from "@/lib/money";
import { formatMoney, type DisplayMoney } from "@/lib/currency";
import { cn } from "@/lib/utils";

export type ReportRowData = {
  id: string;
  condition: ItemCondition;
  amount: string;
  currency: string;
  amountUsd: string;
  soldAt: string;
  status: SaleStatus;
  flagReason: string | null;
  reviewNote: string | null;
  figure: { slug: string; name: string };
};

const STATUS_META: Record<
  SaleStatus,
  { label: string; icon: React.ReactNode; className: string }
> = {
  APPROVED: {
    label: "Counted",
    icon: <CheckCircle2 className="size-3.5" />,
    className: "border-up/40 bg-up/10 text-up",
  },
  PENDING_REVIEW: {
    label: "Awaiting review",
    icon: <Clock className="size-3.5" />,
    className: "border-border bg-surface-2 text-muted",
  },
  REJECTED: {
    label: "Not counted",
    icon: <XCircle className="size-3.5" />,
    className: "border-down/40 bg-down/10 text-down",
  },
};

export function ReportRow({
  report,
  money,
}: {
  report: ReportRowData;
  money: DisplayMoney;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const meta = STATUS_META[report.status];

  function remove() {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("saleId", report.id);
      const result = await deleteMyReport(formData);
      if (result.ok) router.refresh();
      else {
        setError(result.error);
        setConfirming(false);
      }
    });
  }

  return (
    <li className="rounded-xl border border-border bg-surface p-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <Link
            href={`/figures/${report.figure.slug}`}
            className="block truncate text-sm font-medium hover:text-accent"
          >
            {report.figure.name}
          </Link>
          <p className="mt-0.5 text-xs text-muted">
            {CONDITION_LABELS[report.condition]} · sold{" "}
            {new Date(report.soldAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>

        <div className="text-right">
          <p className="tabular text-sm font-semibold">
            {formatMoney(report.amountUsd, money, {
              original: { amount: report.amount, currency: report.currency },
            })}
          </p>
          {report.currency !== "USD" && (
            <p className="tabular text-xs text-muted">
              {formatCurrency(report.amount, report.currency)}
            </p>
          )}
        </div>

        <span
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium",
            meta.className,
          )}
        >
          {meta.icon}
          {meta.label}
        </span>

        {confirming ? (
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="rounded-md bg-down px-2 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : "Delete"}
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
            aria-label="Delete this report"
            className="shrink-0 rounded-md border border-border p-1.5 text-muted transition hover:border-down/60 hover:text-down"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>

      {report.status === "PENDING_REVIEW" && report.flagReason && (
        <p className="mt-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs leading-snug text-muted">
          {report.flagReason}
        </p>
      )}
      {report.status === "REJECTED" && (
        <p className="mt-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs leading-snug text-muted">
          {report.reviewNote ?? "A moderator determined this didn't reflect a real sale price."}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-down">{error}</p>}
    </li>
  );
}
