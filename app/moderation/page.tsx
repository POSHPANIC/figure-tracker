import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { currentUser } from "@/auth";
import { ModerationRow } from "@/components/moderation-row";
import { getModerationQueue, getReporterHistory } from "@/lib/user-queries";

export const metadata: Metadata = {
  title: "Moderation queue",
  robots: { index: false, follow: false },
};

export default async function ModerationPage() {
  const user = await currentUser();
  if (!user) redirect("/signin?callbackUrl=%2Fmoderation");

  // 404 rather than 403 — no reason to confirm this page exists to people who
  // can't use it.
  if (user.role !== "MODERATOR" && user.role !== "ADMIN") notFound();

  const { items, pendingCount } = await getModerationQueue();

  // Reporter track record, fetched once per distinct reporter.
  const reporterIds = [...new Set(items.map((i) => i.reportedBy?.id).filter(Boolean))] as string[];
  const histories = new Map(
    await Promise.all(
      reporterIds.map(async (id) => [id, await getReporterHistory(id)] as const),
    ),
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ShieldCheck className="size-5 text-accent" />
          Moderation queue
        </h1>
        <p className="mt-1 text-sm text-muted">
          {pendingCount === 0 ? (
            "Nothing waiting."
          ) : (
            <>
              <span className="tabular">{pendingCount}</span>{" "}
              {pendingCount === 1 ? "report" : "reports"} awaiting review. None of these affect
              published prices until approved.
            </>
          )}
        </p>
      </header>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="font-medium">Queue is clear</p>
          <p className="mt-1 text-sm text-muted">
            Reports only land here when they look unusual against a figure's existing prices.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const history = item.reportedBy?.id
              ? histories.get(item.reportedBy.id)
              : undefined;

            return (
              <ModerationRow
                key={item.id}
                item={{
                  id: item.id,
                  condition: item.condition,
                  amount: item.amount.toString(),
                  currency: item.currency,
                  amountUsd: item.amountUsd.toString(),
                  soldAt: item.soldAt.toISOString(),
                  url: item.url,
                  flagReason: item.flagReason,
                  createdAt: item.createdAt.toISOString(),
                  reporter: {
                    label:
                      item.reportedBy?.username ??
                      item.reportedBy?.name ??
                      item.reportedBy?.email ??
                      "deleted account",
                    username: item.reportedBy?.username ?? null,
                    approved: history?.approved ?? 0,
                    rejected: history?.rejected ?? 0,
                  },
                  figure: {
                    slug: item.figure.slug,
                    name: item.figure.name,
                    marketValueUsd: item.figure.marketValueUsd?.toString() ?? null,
                    salesVolume90d: item.figure.salesVolume90d,
                  },
                }}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}
