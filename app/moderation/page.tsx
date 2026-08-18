import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { Inbox } from "lucide-react";
import { currentUser } from "@/auth";
import { SubmissionRow } from "@/components/submission-row";
import { getSubmissionQueue } from "@/lib/user-queries";

export const metadata: Metadata = {
  title: "Submissions",
  robots: { index: false, follow: false },
};

export default async function ModerationPage() {
  const user = await currentUser();
  if (!user) redirect("/signin?callbackUrl=%2Fmoderation");

  // 404 rather than 403 — no reason to confirm this page exists to people who
  // can't use it.
  if (user.role !== "MODERATOR" && user.role !== "ADMIN") notFound();

  const { items, openCount, counts } = await getSubmissionQueue();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Inbox className="size-5 text-accent" />
          Submissions
        </h1>
        <p className="mt-1 text-sm text-muted">
          {openCount === 0 ? (
            "Nothing waiting."
          ) : (
            <>
              <span className="tabular">{openCount}</span> open —{" "}
              <span className="tabular">{counts.BUG}</span>{" "}
              {counts.BUG === 1 ? "bug" : "bugs"},{" "}
              <span className="tabular">{counts.FIGURE}</span> figure{" "}
              {counts.FIGURE === 1 ? "request" : "requests"},{" "}
              <span className="tabular">{counts.EDIT}</span>{" "}
              {counts.EDIT === 1 ? "edit" : "edits"},{" "}
              <span className="tabular">{counts.SALE}</span>{" "}
              {counts.SALE === 1 ? "sale" : "sales"},{" "}
              <span className="tabular">{counts.FEEDBACK}</span> feedback. Oldest first.
            </>
          )}
        </p>
      </header>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="font-medium">Inbox is clear</p>
          <p className="mt-1 text-sm text-muted">
            Bug reports, figure requests, suggested edits and feedback from the{" "}
            <a href="/feedback" className="text-accent hover:underline">
              feedback form
            </a>{" "}
            land here.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <SubmissionRow key={item.id} submission={item} />
          ))}
        </ul>
      )}
    </div>
  );
}
