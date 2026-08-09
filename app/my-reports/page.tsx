import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ClipboardList } from "lucide-react";
import { currentUser } from "@/auth";
import { ReportRow } from "@/components/report-row";
import { getMyReports, getReporterHistory } from "@/lib/user-queries";

export const metadata: Metadata = {
  title: "My sale reports",
  description: "Sales you've reported and their review status.",
};

export default async function MyReportsPage() {
  const user = await currentUser();
  if (!user) redirect("/signin?callbackUrl=%2Fmy-reports");

  const [reports, history] = await Promise.all([
    getMyReports(user.id),
    getReporterHistory(user.id),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">My sale reports</h1>
        <p className="mt-1 text-sm text-muted">
          <span className="tabular">{history.approved}</span> counted ·{" "}
          <span className="tabular">{history.pending}</span> awaiting review ·{" "}
          <span className="tabular">{history.rejected}</span> not counted
        </p>
      </header>

      {reports.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-xl bg-surface-2 text-muted">
            <ClipboardList className="size-6" />
          </span>
          <p className="mt-4 font-medium">You haven't reported any sales</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
            Bought or sold a figure recently? Reporting the price is the single most useful thing
            you can do here — it's what the price charts are built from.
          </p>
          <Link
            href="/figures"
            className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
          >
            Find a figure
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {reports.map((r) => (
            <ReportRow
              key={r.id}
              report={{
                id: r.id,
                condition: r.condition,
                amount: r.amount.toString(),
                currency: r.currency,
                amountUsd: r.amountUsd.toString(),
                soldAt: r.soldAt.toISOString(),
                status: r.status,
                flagReason: r.flagReason,
                reviewNote: r.reviewNote,
                figure: { slug: r.figure.slug, name: r.figure.name },
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
