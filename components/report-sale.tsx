"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2, ClipboardList, Clock, Loader2, X } from "lucide-react";
import { reportSale } from "@/lib/actions/sales";
import { CONDITION_LABELS } from "@/lib/labels";
import type { ItemCondition } from "@/lib/generated/prisma/enums";
import { cn } from "@/lib/utils";

const CONDITION_OPTIONS: ItemCondition[] = [
  "NEW_SEALED",
  "NEW_OPENED",
  "USED_COMPLETE",
  "USED_INCOMPLETE",
  "DAMAGED",
];

const CURRENCIES = ["USD", "JPY", "EUR", "GBP", "CAD", "AUD"];

type Outcome = { status: "APPROVED" | "PENDING_REVIEW"; message: string };

/**
 * "I bought/sold this" reporting.
 *
 * The copy here matters as much as the code: people need to understand that
 * what they enter becomes part of a public price index, and that a report
 * flagged for review isn't an accusation.
 */
export function ReportSale({ figureId, signedIn }: { figureId: string; signedIn: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pending, startTransition] = useTransition();

  const today = new Date().toISOString().slice(0, 10);

  function submit(formData: FormData) {
    setError(null);
    setOutcome(null);
    startTransition(async () => {
      const result = await reportSale(formData);
      if (result.ok) {
        setOutcome({ status: result.status, message: result.message });
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  if (!signedIn) {
    return (
      <p className="text-xs text-muted">
        <a
          href={`/signin?callbackUrl=${encodeURIComponent(`/figures`)}`}
          className="text-accent hover:underline"
        >
          Sign in
        </a>{" "}
        to report a sale price you've seen.
      </p>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setOutcome(null);
        }}
        className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition hover:border-accent/60"
      >
        {open ? <X className="size-3.5" /> : <ClipboardList className="size-3.5" />}
        {open ? "Cancel" : "Report a sale"}
      </button>

      {outcome && (
        <div
          className={cn(
            "mt-2 flex gap-2 rounded-lg border px-3 py-2 text-xs",
            outcome.status === "APPROVED"
              ? "border-up/40 bg-up/10 text-up"
              : "border-border bg-surface-2 text-muted",
          )}
        >
          {outcome.status === "APPROVED" ? (
            <CheckCircle2 className="mt-px size-4 shrink-0" />
          ) : (
            <Clock className="mt-px size-4 shrink-0" />
          )}
          <p className="leading-snug">{outcome.message}</p>
        </div>
      )}

      {error && (
        <p className="mt-2 rounded-lg border border-down/40 bg-down/10 px-3 py-2 text-xs text-down">
          {error}
        </p>
      )}

      {open && (
        <form action={submit} className="mt-3 space-y-3 rounded-xl border border-border bg-surface-2 p-3">
          <input type="hidden" name="figureId" value={figureId} />

          <p className="text-xs leading-snug text-muted">
            Report a price this figure <em>actually sold for</em> — not an asking price. Reports
            feed the public price history, so unusual ones are checked by a moderator first.
          </p>

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Field label="Sale price">
              <input
                type="number"
                name="amount"
                required
                min={0}
                step="0.01"
                placeholder="0.00"
                className="tabular w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
              />
            </Field>
            <Field label="Currency">
              <select
                name="currency"
                defaultValue="USD"
                className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Condition">
              <select
                name="condition"
                defaultValue="NEW_SEALED"
                className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
              >
                {CONDITION_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {CONDITION_LABELS[c]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Date sold">
              <input
                type="date"
                name="soldAt"
                required
                max={today}
                defaultValue={today}
                className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
              />
            </Field>
          </div>

          <Field label="Link to the listing (optional)">
            <input
              type="url"
              name="url"
              placeholder="https://…"
              className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
            />
          </Field>

          <button
            type="submit"
            disabled={pending}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            Submit report
          </button>
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
