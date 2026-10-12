"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { editFigure, suggestNames } from "@/lib/actions/figure-edit";
import { SuggestInput, type SuggestOption } from "@/components/suggest-input";
import type { EditField } from "@/lib/figure-edit";
import { CATEGORY_LABELS, STATUS_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";

/** The currencies a maker prices in, most used first. */
const CURRENCIES = ["JPY", "USD", "EUR", "GBP", "CNY", "HKD", "KRW", "TWD", "CAD", "AUD"] as const;

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-foreground";

/**
 * The figure, as an editor changes it.
 *
 * The form starts from what the page shows and sends all of it; the action
 * works out what actually changed, server-side, and only those fields are
 * written and locked.
 */
export function FigureEditForm({
  figureId,
  slug,
  values,
  locked,
  scales,
}: {
  figureId: string;
  slug: string;
  values: Record<string, string>;
  /** Scales the catalogue already uses, most common first, for the scale field's suggestions. */
  scales: readonly string[];
  /** Fields already confirmed by someone, and by whom. Shown, not enforced. */
  locked: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<EditField, string>>>({});

  function submit(formData: FormData) {
    setError(null);
    setFieldErrors({});
    start(async () => {
      const result = await editFigure(formData);
      if (!result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      // Replace, not push: the edit page took the figure page's place in
      // history when it opened, and gives it back here, so Back never lands
      // on the edit page again.
      router.replace(`/figures/${slug}`);
      router.refresh();
    });
  }

  const field = (
    name: EditField,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
    lockKey?: string,
    suggest?: { options?: readonly string[]; fetch?: (q: string) => Promise<SuggestOption[]>; multiple?: boolean },
  ) => (
    <label className="block">
      <span className="mb-1 flex justify-between text-xs text-muted">
        {label}
        {lockKey && locked[lockKey] && <span title={locked[lockKey]}>confirmed</span>}
      </span>
      {suggest ? (
        <SuggestInput
          name={name}
          defaultValue={values[name] ?? ""}
          options={suggest.options}
          fetchOptions={suggest.fetch}
          multiple={suggest.multiple}
          className={cn(inputClass, fieldErrors[name] && "border-alert")}
          inputProps={props}
        />
      ) : (
        <input
          name={name}
          defaultValue={values[name] ?? ""}
          className={cn(inputClass, fieldErrors[name] && "border-alert")}
          {...props}
        />
      )}
      {fieldErrors[name] && <span className="mt-1 block text-xs text-alert">{fieldErrors[name]}</span>}
    </label>
  );

  const select = (name: EditField, label: string, options: Record<string, string>) => (
    <label className="block">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      <select name={name} defaultValue={values[name]} className={inputClass}>
        {Object.entries(options).map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
      {fieldErrors[name] && <span className="mt-1 block text-xs text-alert">{fieldErrors[name]}</span>}
    </label>
  );

  return (
    <form action={submit} className="space-y-4">
      <input type="hidden" name="figureId" value={figureId} />

      {field("name", "Name", { required: true }, "name")}
      {field("nameJa", "Japanese name", { placeholder: "爆豪勝己" }, "name")}

      <div className="grid gap-4 sm:grid-cols-2">
        {select("category", "Type", CATEGORY_LABELS)}
        {select("status", "Status", STATUS_LABELS)}
      </div>

      {field("manufacturer", "Manufacturer", { placeholder: "Good Smile Company" }, "manufacturer", {
        fetch: (q) => suggestNames("manufacturer", q),
      })}
      {field("characters", "Characters", { placeholder: "Marin Kitagawa, Shinju Inui — comma between several" }, "character", {
        fetch: (q) => suggestNames("character", q, figureId),
        multiple: true,
      })}

      <div className="grid gap-4 sm:grid-cols-3">
        {field("scale", "Scale", { placeholder: "1/7" }, "scale", { options: scales })}
        {field("heightMm", "Height (mm)", { inputMode: "numeric", placeholder: "230" }, "heightMm")}
        {field("releaseDate", "Released", { placeholder: "2024-05 or 2024-05-17" }, "releaseDate")}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">{field("msrpAmount", "MSRP", { inputMode: "decimal", placeholder: "16093" }, "msrp")}</div>
        {field("msrpCurrency", "Currency", { placeholder: "JPY", maxLength: 3 }, "msrp", { options: CURRENCIES })}
      </div>

      {field("jan", "JAN barcode", { inputMode: "numeric", placeholder: "4580590174665" })}

      <p className="text-xs text-muted">
        Fields you change are marked confirmed, so imports leave them alone. The page address stays the same if you
        rename it.
      </p>

      {error && <p className="text-sm text-alert">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="flex items-center justify-center gap-2 rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60"
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          Save
        </button>
        <Link href={`/figures/${slug}`} replace className="text-sm text-muted hover:text-foreground hover:underline">
          Cancel
        </Link>
      </div>
    </form>
  );
}
