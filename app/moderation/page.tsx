import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { Inbox, PackageSearch } from "lucide-react";
import { currentUser } from "@/auth";
import { CandidateRow } from "@/components/candidate-row";
import { SubmissionRow } from "@/components/submission-row";
import { getFigureCandidates, getSubmissionQueue } from "@/lib/user-queries";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

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

  const [{ items, openCount, counts }, candidates] = await Promise.all([
    getSubmissionQueue(),
    getFigureCandidates(),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl uppercase tracking-[0.14em]">
          <Inbox className="size-5 text-foreground" />
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
            <a href="/feedback" className="term-link">
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

      {candidates.openCount > 0 && (
        <section className="mt-10">
          <h2 className="flex items-center gap-2 text-lg uppercase tracking-[0.14em]">
            <PackageSearch className="size-4 text-foreground" />
            Possibly missing
          </h2>
          <p className="mt-1 text-sm text-muted">
            <span className="tabular">{candidates.openCount}</span>{" "}
            {candidates.openCount === 1 ? "product" : "products"} the catalogue may be missing. Two
            sources: release numbers that several eBay sellers list and no figure carries, and
            products a retailer stocks — which is how manufacturers outside the Good Smile group get
            here at all. The Good Smile archive stopped publishing in February 2024, so anything
            released since is absent. Nothing here is in the catalogue until you put it there.
          </p>
          <ul className="mt-4 space-y-3">
            {candidates.items.map((candidate) => (
              <CandidateRow key={candidate.id} candidate={candidate} />
            ))}
          </ul>
          {candidates.openCount > candidates.items.length && (
            <p className="mt-3 text-xs text-muted">
              Showing {candidates.items.length} of {candidates.openCount}.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
