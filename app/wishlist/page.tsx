import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Heart } from "lucide-react";
import { currentUser } from "@/auth";
import { FigureCard } from "@/components/figure-card";
import { getWishlist } from "@/lib/user-queries";
import { formatMoney } from "@/lib/currency";
import { figureValue } from "@/lib/figure-value";
import { getDisplayMoney } from "@/lib/currency-server";

export const metadata: Metadata = {
  title: "Wishlist",
  description: "Figures you're hunting for.",
};

export default async function WishlistPage() {
  const user = await currentUser();
  if (!user) redirect("/signin?callbackUrl=%2Fwishlist");

  const [items, money] = await Promise.all([getWishlist(user.id), getDisplayMoney()]);
  const total = items.reduce(
    (sum, item) => sum + (figureValue(item.figure)?.amountUsd ?? 0),
    0,
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl uppercase tracking-[0.14em]">Wishlist</h1>
        <p className="mt-1 text-sm text-muted">
          {items.length === 0 ? (
            "Nothing here yet."
          ) : (
            <>
              <span className="tabular">{items.length}</span>{" "}
              {items.length === 1 ? "figure" : "figures"} · about{" "}
              <span className="tabular font-medium text-foreground">{formatMoney(total, money)}</span> at
              today's prices
            </>
          )}
        </p>
      </header>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-xl bg-surface-2 text-muted">
            <Heart className="size-6" />
          </span>
          <p className="mt-4 font-medium">No figures on your wishlist</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
            Hit the wishlist button on any figure to keep an eye on it.
          </p>
          <Link
            href="/figures"
            className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
          >
            Browse figures
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {items.map((item) => (
            <FigureCard key={item.id} figure={item.figure} />
          ))}
        </div>
      )}
    </div>
  );
}
