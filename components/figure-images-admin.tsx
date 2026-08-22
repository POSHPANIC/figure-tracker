"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ImagePlus, Loader2, Star, Trash2, X } from "lucide-react";
import {
  addFigureImage,
  removeFigureImage,
  setPrimaryFigureImage,
} from "@/lib/actions/images";
import { cn } from "@/lib/utils";

export type AdminImage = {
  id: string;
  url: string;
  credit: string | null;
  sourceUrl: string | null;
  licenseNote: string | null;
  isPrimary: boolean;
};

/**
 * Moderator-only panel for managing a figure's catalog images.
 *
 * Only rendered for moderators; the server actions check the role again, since
 * hiding a control is presentation, not access control.
 */
export function FigureImagesAdmin({
  figureId,
  images,
}: {
  figureId: string;
  images: AdminImage[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>, fd: FormData, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action(fd);
      if (result.ok) {
        onOk?.();
        router.refresh();
      } else {
        setError(result.error ?? "Something went wrong.");
      }
    });
  }

  return (
    <section className="rounded-xl border border-dashed border-border bg-surface p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm uppercase tracking-[0.14em]">Catalog images</h2>
          <p className="mt-0.5 text-xs text-muted">
            Moderators only. Manufacturer press photos used with permission — record the credit
            and what was agreed.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition hover:border-foreground"
        >
          {open ? <X className="size-3.5" /> : <ImagePlus className="size-3.5" />}
          {open ? "Cancel" : "Add image"}
        </button>
      </div>

      {error && (
        <p className="mb-3 rounded-lg border border-down/40 bg-down/10 px-3 py-2 text-xs text-down">
          {error}
        </p>
      )}

      {images.length > 0 && (
        <ul className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {images.map((img) => (
            <li
              key={img.id}
              className={cn(
                "overflow-hidden rounded-lg border",
                img.isPrimary ? "border-foreground" : "border-border",
              )}
            >
              <div className="aspect-square bg-surface-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- press image hosts vary */}
                <img
                  src={img.url}
                  alt={img.credit ?? ""}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="p-2">
                <p className="truncate text-[11px] text-muted" title={img.credit ?? ""}>
                  {img.credit ?? "no credit recorded"}
                </p>
                <div className="mt-1.5 flex gap-1">
                  <button
                    type="button"
                    disabled={pending || img.isPrimary}
                    onClick={() => {
                      const fd = new FormData();
                      fd.set("imageId", img.id);
                      run(setPrimaryFigureImage, fd);
                    }}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1 rounded-md border px-1.5 py-1 text-[11px] transition",
                      img.isPrimary
                        ? "border-foreground bg-foreground text-background"
                        : "border-border text-muted hover:text-foreground",
                    )}
                  >
                    <Star className={cn("size-3", img.isPrimary && "fill-current")} />
                    {img.isPrimary ? "Primary" : "Make primary"}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      const fd = new FormData();
                      fd.set("imageId", img.id);
                      run(removeFigureImage, fd);
                    }}
                    aria-label="Remove image"
                    className="rounded-md border border-border p-1 text-muted transition hover:border-down/60 hover:text-down"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <form
          action={(fd) => {
            fd.set("figureId", figureId);
            run(addFigureImage, fd, () => setOpen(false));
          }}
          className="space-y-2.5 rounded-lg border border-border bg-surface-2 p-3"
        >
          <Field label="Image URL" hint="Must be https. Link straight to the image file.">
            <input
              type="url"
              name="url"
              required
              placeholder="https://…/marin_swimsuit_01.jpg"
              className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-foreground"
            />
          </Field>

          <Field label="Credit" hint="Shown under the image. Usually required by the permission.">
            <input
              type="text"
              name="credit"
              required
              placeholder="© Good Smile Company"
              className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-foreground"
            />
          </Field>

          <Field label="Source page (optional)" hint="The press kit or product page it came from.">
            <input
              type="url"
              name="sourceUrl"
              placeholder="https://www.goodsmile.com/…"
              className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-foreground"
            />
          </Field>

          <Field
            label="Permission note (optional)"
            hint="Who granted it and when — your evidence if anyone asks."
          >
            <textarea
              name="licenseNote"
              rows={2}
              maxLength={500}
              placeholder="Email from GSC press office, 12 Aug 2026 — press images OK with credit and link back."
              className="w-full resize-y rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-foreground"
            />
          </Field>

          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" name="makePrimary" className="size-3.5 accent-[var(--accent)]" />
            Use as the main product photo
          </label>

          <button
            type="submit"
            disabled={pending}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60"
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            Add image
          </button>
        </form>
      )}
    </section>
  );
}

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
      <span className="mb-1 block text-[10px] uppercase tracking-wide text-muted">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[10px] text-muted">{hint}</span>}
    </label>
  );
}
