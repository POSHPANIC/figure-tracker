"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Ban, Loader2 } from "lucide-react";
import { rejectListing } from "@/lib/actions/listing-reject";
import { canEditFigures } from "@/lib/figure-edit";

/**
 * "Not this figure", on a listing row, for moderators and admins.
 *
 * Decided in the browser from the session because the figure page is cached
 * for everyone; the action checks the role again, against the database, so
 * showing the button to someone is never what lets them use it.
 */
export function RejectListingButton({ listingId }: { listingId: string }) {
  const { data: session } = useSession();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<"idle" | "done" | "error">("idle");

  if (!canEditFigures(session?.user?.role)) return null;
  if (state === "done") return <span className="shrink-0 text-xs text-muted">Removed</span>;

  return (
    <button
      type="button"
      disabled={pending}
      title={state === "error" ? "That didn't work. Try again." : "Not this figure: take this listing off the page for good"}
      aria-label="Not this figure"
      onClick={() => {
        if (!window.confirm("Take this listing off this figure? The matcher won't put it back here.")) return;
        start(async () => {
          const result = await rejectListing(listingId);
          if (!result.ok) {
            setState("error");
            return;
          }
          setState("done");
          router.refresh();
        });
      }}
      className={
        "shrink-0 rounded border px-1.5 py-1 transition " +
        (state === "error"
          ? "border-alert text-alert"
          : "border-border text-muted hover:border-alert hover:text-alert")
      }
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Ban className="size-3.5" />}
    </button>
  );
}
