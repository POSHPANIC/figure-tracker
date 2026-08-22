import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Boxes, Plus } from "lucide-react";
import { currentUser } from "@/auth";
import { CollectionRow } from "@/components/collection-row";
import { getCollection } from "@/lib/user-queries";
import { formatPercent } from "@/lib/money";
import { formatMoney } from "@/lib/currency";
import { getDisplayMoney } from "@/lib/currency-server";
import { cn } from "@/lib/utils";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: "My collection",
  description: "Everything you own, what you paid, and what it's worth now.",
};

export default async function CollectionPage() {
  const user = await currentUser();
  if (!user) redirect("/signin?callbackUrl=%2Fcollection");

  const [{ items, totals }, money] = await Promise.all([
    getCollection(user.id),
    getDisplayMoney(),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl uppercase tracking-[0.14em]">My collection</h1>
          <p className="mt-1 text-sm text-muted">
            <span className="tabular">{totals.itemCount}</span>{" "}
            {totals.itemCount === 1 ? "figure" : "figures"} across{" "}
            <span className="tabular">{totals.uniqueFigures}</span>{" "}
            {totals.uniqueFigures === 1 ? "entry" : "entries"}
          </p>
        </div>
        <Link
          href="/figures"
          className="flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background transition hover:opacity-90"
        >
          <Plus className="size-4" /> Add figures
        </Link>
      </header>

      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label={totals.valueBasis === "asking" ? "Estimated value" : "Market value"}
              value={formatMoney(totals.marketValueUsd, money)}
              emphasis
            />
            <Stat label="Total paid" value={formatMoney(totals.paidUsd, money)} />
            <Stat
              label="Gain / loss"
              value={formatMoney(totals.gainUsd, money)}
              tone={totals.gainUsd > 0 ? "up" : totals.gainUsd < 0 ? "down" : undefined}
            />
            <Stat
              label="Return"
              value={totals.gainPct === null ? "—" : formatPercent(totals.gainPct)}
              tone={
                totals.gainPct === null
                  ? undefined
                  : totals.gainPct > 0
                    ? "up"
                    : totals.gainPct < 0
                      ? "down"
                      : undefined
              }
            />
          </div>

          {totals.itemsWithoutCost > 0 && (
            <p className="mb-4 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted">
              <span className="tabular font-medium text-foreground">
                {totals.itemsWithoutCost}
              </span>{" "}
              {totals.itemsWithoutCost === 1 ? "figure has" : "figures have"} no purchase price
              recorded, so {totals.itemsWithoutCost === 1 ? "it is" : "they are"} left out of the
              gain and return figures above.
            </p>
          )}

          <ul className="space-y-2">
            {items.map((item) => (
              <CollectionRow key={item.id} item={serialize(item)} money={money} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * Prisma Decimals can't cross the server/client boundary, so flatten them to
 * strings before handing rows to a client component.
 */
function serialize(item: Awaited<ReturnType<typeof getCollection>>["items"][number]) {
  return {
    id: item.id,
    quantity: item.quantity,
    condition: item.condition,
    paidAmount: item.paidAmount?.toString() ?? null,
    paidCurrency: item.paidCurrency,
    paidAmountUsd: item.paidAmountUsd?.toString() ?? null,
    purchasedAt: item.purchasedAt?.toISOString() ?? null,
    figure: {
      slug: item.figure.slug,
      name: item.figure.name,
      primaryImageUrl: item.figure.primaryImageUrl,
      seriesName: item.figure.series?.name ?? null,
      manufacturerName: item.figure.manufacturer?.name ?? null,
      marketValueUsd: item.figure.marketValueUsd?.toString() ?? null,
      // Carried too, or the row falls back to nothing: market value is null on
      // every figure and the asking median is the number it actually shows.
      askMedianUsd: item.figure.askMedianUsd?.toString() ?? null,
      askListings: item.figure.askListings,
    },
  };
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border py-16 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-xl bg-surface-2 text-muted">
        <Boxes className="size-6" />
      </span>
      <p className="mt-4 font-medium">Your collection is empty</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
        Find a figure you own and hit “Add to collection”. Record what you paid and{" "}
        {SITE_NAME} will track your gain or loss against the market.
      </p>
      <Link
        href="/figures"
        className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
      >
        Browse figures
      </Link>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  emphasis,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted">{label}</p>
      <p
        className={cn(
          "tabular mt-0.5 font-semibold",
          emphasis ? "text-xl" : "text-base",
          tone === "up" && "text-up",
          tone === "down" && "text-down",
        )}
      >
        {value}
      </p>
    </div>
  );
}
