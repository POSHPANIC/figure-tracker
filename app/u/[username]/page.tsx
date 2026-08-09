import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { FigureCard } from "@/components/figure-card";
import { getPublicProfile } from "@/lib/user-queries";
import { formatUsd } from "@/lib/money";
import { CONDITION_LABELS } from "@/lib/labels";

export async function generateMetadata({
  params,
}: PageProps<"/u/[username]">): Promise<Metadata> {
  const { username } = await params;
  const profile = await getPublicProfile(username);
  if (!profile) return { title: "Profile not found" };

  const name = profile.user.name ?? profile.user.username;
  return {
    title: `${name}'s collection`,
    description:
      profile.user.bio ??
      `${name} collects ${profile.publicTotals.uniqueFigures} anime figures on FigureTracker.`,
  };
}

export default async function PublicProfilePage({ params }: PageProps<"/u/[username]">) {
  const { username } = await params;
  const profile = await getPublicProfile(username);

  // A private profile and a nonexistent one look identical from outside —
  // otherwise 404-vs-403 would leak which usernames are taken.
  if (!profile) notFound();

  const { user, items, publicTotals } = profile;
  const displayName = user.name ?? user.username;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-8 flex flex-wrap items-start gap-4">
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- avatar hosts vary by provider
          <img src={user.image} alt="" className="size-16 rounded-full object-cover" />
        ) : (
          <span className="grid size-16 place-items-center rounded-full bg-accent text-xl font-semibold text-white">
            {displayName?.[0]?.toUpperCase() ?? "?"}
          </span>
        )}

        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{displayName}</h1>
          <p className="text-sm text-muted">@{user.username}</p>
          {user.bio && <p className="mt-2 max-w-prose text-sm">{user.bio}</p>}
        </div>

        <dl className="flex gap-6">
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-muted">Figures</dt>
            <dd className="tabular text-lg font-semibold">{publicTotals.itemCount}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-muted">Collection value</dt>
            <dd className="tabular text-lg font-semibold">
              {formatUsd(publicTotals.marketValueUsd)}
            </dd>
          </div>
        </dl>
      </header>

      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted">
          {displayName} hasn't added any figures yet.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {items.map((item) => (
            <div key={item.id}>
              <FigureCard figure={item.figure} />
              <p className="mt-1 px-1 text-[11px] text-muted">
                <span className="tabular">{item.quantity}×</span>{" "}
                {CONDITION_LABELS[item.condition].toLowerCase()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
