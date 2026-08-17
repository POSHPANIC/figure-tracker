"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Bug,
  Check,
  ExternalLink,
  Lock,
  LockOpen,
  MessageSquare,
  PackagePlus,
  PencilLine,
  X,
} from "lucide-react";
import {
  lockFigureField,
  reviewSubmission,
  unlockFigureField,
} from "@/lib/actions/submissions";
import type { SubmissionKind } from "@/lib/generated/prisma/enums";
import { FIELD_LABELS } from "@/lib/figure-fields";
import { cn } from "@/lib/utils";

export type QueuedSubmission = {
  id: string;
  kind: SubmissionKind;
  details: string;
  pageUrl: string | null;
  figureName: string | null;
  manufacturer: string | null;
  series: string | null;
  referenceUrl: string | null;
  imageUrl: string | null;
  proposedFields: unknown;
  figure: { id: string; slug: string; name: string; fieldLocks: { field: string }[] } | null;
  contactEmail: string | null;
  createdAt: Date;
  user: { id: string; username: string | null; name: string | null; email: string | null } | null;
};

const KIND_META: Record<SubmissionKind, { label: string; icon: React.ReactNode; tone: string }> = {
  FEEDBACK: {
    label: "Feedback",
    icon: <MessageSquare className="size-3.5" />,
    tone: "border-border text-muted",
  },
  BUG: {
    label: "Bug",
    icon: <Bug className="size-3.5" />,
    tone: "border-down/40 bg-down/10 text-down",
  },
  FIGURE: {
    label: "Missing figure",
    icon: <PackagePlus className="size-3.5" />,
    tone: "border-accent/40 bg-accent/10 text-accent",
  },
  EDIT: {
    label: "Suggested edit",
    icon: <PencilLine className="size-3.5" />,
    tone: "border-accent/40 bg-accent/10 text-accent",
  },
};

/** Prisma hands JSON back as unknown, and a moderator's page is no place to trust it. */
function isFieldMap(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === "string")
  );
}

/**
 * One item in the inbox.
 *
 * "Resolved" and "Declined" both close an item; the distinction is only for
 * whoever reads the queue later. Neither deletes anything — a submission is a
 * record of what someone told us, and that stays useful after it's handled.
 */
export function SubmissionRow({ submission }: { submission: QueuedSubmission }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const meta = KIND_META[submission.kind];

  function decide(decision: "RESOLVED" | "DECLINED", note: string) {
    setError(null);
    const formData = new FormData();
    formData.set("submissionId", submission.id);
    formData.set("decision", decision);
    if (note) formData.set("note", note);

    startTransition(async () => {
      const result = await reviewSubmission(formData);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  const sender = submission.user
    ? (submission.user.username ? `@${submission.user.username}` : null) ??
      submission.user.name ??
      submission.user.email ??
      "account"
    : (submission.contactEmail ?? "anonymous");

  return (
    <li className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-medium",
            meta.tone,
          )}
        >
          {meta.icon}
          {meta.label}
        </span>
        <span className="text-muted">
          {submission.createdAt.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </span>
        <span className="text-muted">·</span>
        <span className={cn("text-muted", !submission.user && "italic")}>{sender}</span>
      </div>

      {submission.kind === "FIGURE" && (
        <dl className="mb-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[8rem_1fr]">
          <Detail label="Name">{submission.figureName}</Detail>
          <Detail label="Manufacturer">{submission.manufacturer}</Detail>
          <Detail label="Series">{submission.series}</Detail>
          <Detail label="Reference">
            {submission.referenceUrl && (
              <a
                href={submission.referenceUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex items-center gap-1 break-all text-accent hover:underline"
              >
                {submission.referenceUrl}
                <ExternalLink className="size-3 shrink-0" />
              </a>
            )}
          </Detail>
        </dl>
      )}

      {submission.kind === "EDIT" && (
        <dl className="mb-3 space-y-1.5 rounded-lg border border-border bg-surface-2 p-3 text-sm">
          <Detail label="Figure">
            {submission.figure ? (
              <a
                href={`/figures/${submission.figure.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-accent hover:underline"
              >
                {submission.figure.name}
                <ExternalLink className="size-3 shrink-0" />
              </a>
            ) : (
              // The figure was deleted after this was sent; the relation is
              // SetNull so the suggestion survives it.
              <span className="text-muted">no longer in the catalogue</span>
            )}
          </Detail>
          {/*
            Shown as a list of proposed values rather than a diff. Storing the
            old value alongside would let the queue print an arrow, but it
            would also be a snapshot going stale from the moment it was taken
            — the figure page is one click away and always right.
          */}
          {isFieldMap(submission.proposedFields) && (
            <Detail label="Proposed">
              <ul className="space-y-0.5">
                {Object.entries(submission.proposedFields).map(([key, value]) => (
                  <li key={key} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="text-muted">{FIELD_LABELS[key] ?? key}: </span>
                      <span className="font-medium">{String(value)}</span>
                    </span>
                    {submission.figure && (
                      <FieldLockButton
                        figureId={submission.figure.id}
                        field={key}
                        locked={submission.figure.fieldLocks.some((l) => l.field === key)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </Detail>
          )}
          {submission.imageUrl && (
            <Detail label="Image">
              <a
                href={submission.imageUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex items-center gap-1 break-all text-accent hover:underline"
              >
                {submission.imageUrl}
                <ExternalLink className="size-3 shrink-0" />
              </a>
              <span className="mt-1 block text-xs text-muted">
                Check the licence before publishing this — catalogue images need a
                credit and permission on record.
              </span>
            </Detail>
          )}
        </dl>
      )}

      {submission.kind === "BUG" && submission.pageUrl && (
        <p className="mb-3 text-sm">
          <span className="text-muted">Page: </span>
          <span className="break-all">{submission.pageUrl}</span>
        </p>
      )}

      {/* Sender-supplied text. Rendered as plain text, never as markup. */}
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{submission.details}</p>

      {error && (
        <p className="mt-3 rounded-lg border border-down/40 bg-down/10 px-3 py-2 text-xs text-down">
          {error}
        </p>
      )}

      <form
        action={(formData) => {
          const decision = formData.get("decision");
          decide(
            decision === "DECLINED" ? "DECLINED" : "RESOLVED",
            String(formData.get("note") ?? ""),
          );
        }}
        className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3"
      >
        <input
          type="text"
          name="note"
          maxLength={500}
          placeholder="Note for the record (optional)"
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs outline-none focus:border-accent"
        />
        <button
          type="submit"
          name="decision"
          value="RESOLVED"
          disabled={pending}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-60"
        >
          <Check className="size-3.5" />
          Done
        </button>
        <button
          type="submit"
          name="decision"
          value="DECLINED"
          disabled={pending}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition hover:border-down/60 hover:text-down disabled:opacity-60"
        >
          <X className="size-3.5" />
          Decline
        </button>
      </form>
    </li>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <>
      <dt className="text-xs uppercase tracking-wide text-muted sm:pt-0.5">{label}</dt>
      <dd className="mb-1 sm:mb-0">{children}</dd>
    </>
  );
}

/**
 * Confirm a field as checked, or reopen it.
 *
 * Sits beside the proposed value because that is the moment the check happens:
 * a moderator looking up the box to judge one suggestion has already done the
 * work that settles every future one. Anywhere else and it becomes a separate
 * chore nobody does.
 *
 * Locking says a person verified the value, not that it is beyond question —
 * hence the same button reopens it.
 */
function FieldLockButton({
  figureId,
  field,
  locked,
}: {
  figureId: string;
  field: string;
  locked: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    setError(null);
    const formData = new FormData();
    formData.set("figureId", figureId);
    formData.set("field", field);
    startTransition(async () => {
      const result = await (locked ? unlockFigureField : lockFigureField)(formData);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      title={
        error ??
        (locked
          ? "Confirmed — reopen this field to suggestions"
          : "Confirm this value and close the field to suggestions")
      }
      aria-pressed={locked}
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-1 text-[10px] font-medium transition disabled:opacity-50",
        error
          ? "border-down/40 text-down"
          : locked
            ? "border-up/40 bg-up/10 text-up"
            : "border-border text-muted hover:border-accent/60 hover:text-foreground",
      )}
    >
      {locked ? <Lock className="size-3" /> : <LockOpen className="size-3" />}
      {locked ? "Confirmed" : "Confirm"}
    </button>
  );
}
