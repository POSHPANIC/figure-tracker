"use client";

import { useState, useTransition } from "react";
import {
  Bug,
  CheckCircle2,
  ImagePlus,
  Loader2,
  MessageSquare,
  PackagePlus,
  Receipt,
} from "lucide-react";
import { createSubmission } from "@/lib/actions/submissions";
import { EDITABLE_FIELDS, FIELD_LABELS } from "@/lib/figure-fields";
import { cn } from "@/lib/utils";

type Kind = "FEEDBACK" | "BUG" | "FIGURE" | "EDIT" | "SALE";

const KINDS: {
  value: Kind;
  label: string;
  icon: React.ReactNode;
  blurb: string;
  placeholder: string;
}[] = [
  {
    value: "FEEDBACK",
    label: "Feedback",
    icon: <MessageSquare className="size-4" />,
    blurb: "What works, what doesn't, what's missing. Blunt is fine.",
    placeholder:
      "The price chart is hard to read on my phone — the numbers overlap when I turn it sideways.",
  },
  {
    value: "BUG",
    label: "Bug",
    icon: <Bug className="size-4" />,
    blurb: "Something broken, or a page showing the wrong information.",
    placeholder:
      "Searching for “Nendoroid Rem” returns nothing, but the figure has its own page. Chrome on Windows.",
  },
  {
    value: "SALE",
    label: "Report a sale",
    icon: <Receipt className="size-4" />,
    blurb: "What it actually sold for — yours or one you saw completed.",
    placeholder:
      "Anything worth knowing — where it sold, whether the box was opened, what was included.",
  },
  {
    value: "EDIT",
    label: "Correction",
    icon: <ImagePlus className="size-4" />,
    blurb: "Something wrong on this figure's page, or a photo it should have.",
    placeholder:
      "The height is listed as 210mm but the box says 230mm. Photo of the box below.",
  },
  {
    value: "FIGURE",
    label: "Missing figure",
    icon: <PackagePlus className="size-4" />,
    blurb: "A figure that should be in the catalogue and isn't.",
    placeholder:
      "Anything else worth knowing — the release date, which version it is, where you saw it.",
  },
];

/**
 * One form, three shapes.
 *
 * Kept as a single form rather than three pages because most people arrive
 * knowing they want to tell us something and not which box it belongs in. The
 * selector is a hint to us, not a hurdle for them — every kind works if they
 * pick the wrong one.
 */
export function SubmissionForm({
  initialKind = "FEEDBACK",
  initialPageUrl,
  initialFigureName,
  figure,
  signedIn,
}: {
  initialKind?: Kind;
  initialPageUrl?: string;
  /** What they searched for and did not find, so they don't type it twice. */
  initialFigureName?: string;
  /** Set when arriving from a figure's page, which is the only route to EDIT. */
  figure?: {
    id: string;
    name: string;
    /** What the page says now, so the fields start as an edit, not a blank. */
    current: Record<string, string>;
    hasImage: boolean;
    /** Fields checked against the manufacturer, by key, with the note. */
    confirmed: Record<string, string>;
  } | null;
  signedIn: boolean;
}) {
  const [kind, setKind] = useState<Kind>(initialKind);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // A correction has to be about something. Without a figure there is nothing
  // to correct, so the option is not offered at all rather than offered and
  // then rejected on submit.
  // Both of these are about one particular figure, so neither makes sense
  // without one — offered only when we know which.
  const kinds = figure ? KINDS : KINDS.filter((k) => k.value !== "EDIT" && k.value !== "SALE");
  const active = kinds.find((k) => k.value === kind) ?? kinds[0]!;

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createSubmission(formData);
      if (result.ok) setSent(result.message);
      else setError(result.error);
    });
  }

  if (sent) {
    return (
      <div className="rounded-xl border border-up/40 bg-up/10 p-5">
        <p className="flex items-start gap-2 text-sm text-up">
          <CheckCircle2 className="mt-px size-4 shrink-0" />
          {sent}
        </p>
        <button
          type="button"
          onClick={() => setSent(null)}
          className="mt-3 text-xs text-muted underline-offset-2 hover:text-foreground hover:underline"
        >
          Send another
        </button>
      </div>
    );
  }

  return (
    <form action={submit} className="space-y-5">
      <input type="hidden" name="kind" value={kind} />

      <fieldset>
        <legend className="mb-2 text-xs uppercase tracking-wide text-muted">
          What is this about?
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {kinds.map((k) => (
            <button
              key={k.value}
              type="button"
              onClick={() => setKind(k.value)}
              aria-pressed={kind === k.value}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition",
                kind === k.value
                  ? "border-accent bg-accent/10 text-foreground"
                  : "border-border bg-surface text-muted hover:border-accent/60 hover:text-foreground",
              )}
            >
              {k.icon}
              {k.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">{active.blurb}</p>
      </fieldset>

      {kind === "SALE" && figure && (
        <div className="space-y-4 rounded-xl border border-border bg-surface-2 p-4">
          <input type="hidden" name="figureId" value={figure.id} />
          <p className="text-sm">
            <span className="text-muted">About: </span>
            <span className="font-medium">{figure.name}</span>
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Sold for">
              <input
                type="text"
                name="saleAmount"
                required
                inputMode="decimal"
                placeholder="14500"
                className={inputClass}
              />
            </Field>
            <Field label="Currency">
              <select name="saleCurrency" defaultValue="USD" className={inputClass}>
                {["USD", "JPY", "EUR", "GBP", "CAD", "AUD"].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Date sold">
              <input type="date" name="saleDate" required className={inputClass} />
            </Field>
          </div>
          <Field label="Condition">
            <select name="saleCondition" defaultValue="NEW_SEALED" className={inputClass}>
              <option value="NEW_SEALED">New, sealed</option>
              <option value="NEW_OPENED">New, box opened</option>
              <option value="USED_COMPLETE">Used, complete</option>
              <option value="USED_INCOMPLETE">Used, missing parts</option>
              <option value="DAMAGED">Damaged</option>
            </select>
          </Field>
          <Field
            label="Link to it (optional)"
            hint="A completed listing, invoice or screenshot. Not required, and the single most useful thing you can give whoever reviews this."
          >
            <input type="url" name="saleUrl" placeholder="https://…" className={inputClass} />
          </Field>
          <p className="text-xs text-muted">
            A person checks every reported sale before it reaches a price chart, so
            this won&apos;t show up straight away.
          </p>
        </div>
      )}

      {kind === "EDIT" && figure && (
        <div className="space-y-4 rounded-xl border border-border bg-surface-2 p-4">
          <input type="hidden" name="figureId" value={figure.id} />
          <p className="text-sm">
            <span className="text-muted">About: </span>
            <span className="font-medium">{figure.name}</span>
          </p>

          {/*
            Prefilled with what the page currently says. Correcting a height
            then means changing one number rather than retyping eight fields,
            and an empty box is itself informative — it shows what we are
            missing. Which of these actually changed is decided on the server,
            not here.
          */}
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-1 text-xs uppercase tracking-wide text-muted">
              Change anything that&apos;s wrong
            </legend>
            {EDITABLE_FIELDS.filter((f) => !(f.key in figure.confirmed)).map((f) => (
              <label key={f.key} className="block">
                <span className="mb-1 block text-xs text-muted">{f.label}</span>
                <input
                  type="text"
                  name={f.key}
                  defaultValue={figure.current[f.key] ?? ""}
                  placeholder={f.placeholder}
                  className={inputClass}
                />
              </label>
            ))}
          </fieldset>

          {Object.keys(figure.confirmed).length > 0 && (
            // Named rather than silently absent. A field that vanishes looks
            // like a bug, and someone who has spotted a genuine error needs to
            // know where to take it.
            <p className="text-xs text-muted">
              Checked against the manufacturer and not open to suggestions:{" "}
              <span className="text-foreground">
                {Object.keys(figure.confirmed)
                  .map((k) => FIELD_LABELS[k] ?? k)
                  .join(", ")}
              </span>
              . If one of those is genuinely wrong, say so below and we&apos;ll
              look again.
            </p>
          )}

          {figure.hasImage ? (
            <p className="text-xs text-muted">
              This figure already has a photo, so we&apos;re not taking more. If the
              one shown is wrong or shouldn&apos;t be there, say so below.
            </p>
          ) : (
            <Field
              label="Link to an image (optional)"
              hint="A link, not an upload — we need to know where a photo came from before it goes on the page, so send the product page or press release it appears on."
            >
              <input type="url" name="imageUrl" placeholder="https://…" className={inputClass} />
            </Field>
          )}
        </div>
      )}

      {kind === "BUG" && (
        <Field
          label="Where did it happen?"
          hint="The page address, or just a description of where you were."
        >
          <input
            type="text"
            name="pageUrl"
            defaultValue={initialPageUrl}
            placeholder="/figures/nendoroid-hatsune-miku"
            className={inputClass}
          />
        </Field>
      )}

      {kind === "FIGURE" && (
        <div className="space-y-4 rounded-xl border border-border bg-surface-2 p-4">
          <Field label="Figure name" hint="As printed on the box, if you have it in front of you.">
            <input
              type="text"
              name="figureName"
              required
              defaultValue={initialFigureName}
              placeholder="Nendoroid Marin Kitagawa: Swimsuit Ver."
              className={inputClass}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Manufacturer">
              <input
                type="text"
                name="manufacturer"
                placeholder="Good Smile Company"
                className={inputClass}
              />
            </Field>
            <Field label="Series">
              <input
                type="text"
                name="series"
                placeholder="My Dress-Up Darling"
                className={inputClass}
              />
            </Field>
          </div>
          <Field
            label="Link to it"
            hint="A product page, shop listing or announcement. This is what we check against, so it speeds things up a lot."
          >
            <input
              type="url"
              name="referenceUrl"
              placeholder="https://…"
              className={inputClass}
            />
          </Field>
        </div>
      )}

      <Field
        label={
          kind === "FIGURE" || kind === "EDIT" || kind === "SALE" ? "Anything else" : "Details"
        }
      >
        <textarea
          name="details"
          required={kind !== "EDIT" && kind !== "SALE"}
          minLength={kind === "EDIT" || kind === "SALE" ? 0 : 10}
          maxLength={4000}
          rows={6}
          placeholder={active.placeholder}
          className={cn(inputClass, "resize-y leading-relaxed")}
        />
      </Field>

      {!signedIn && (
        <Field
          label="Your email (optional)"
          hint="Only used to reply to you. Leave it blank and we'll still read this — you just won't hear back."
        >
          <input type="email" name="contactEmail" placeholder="you@example.com" className={inputClass} />
        </Field>
      )}

      {/* Honeypot: hidden from people, irresistible to form-filling bots. */}
      <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      {error && (
        <p className="rounded-lg border border-down/40 bg-down/10 px-3 py-2 text-sm text-down">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="flex items-center justify-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
        Send
      </button>
    </form>
  );
}

const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-accent";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wide text-muted">{label}</span>
      {hint && <span className="mb-1.5 block text-xs text-muted">{hint}</span>}
      {children}
    </label>
  );
}
