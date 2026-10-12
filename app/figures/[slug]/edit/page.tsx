import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { PencilLine } from "lucide-react";
import { currentUser } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canEditFigures, formValues } from "@/lib/figure-edit";
import { FigureEditForm } from "@/components/figure-edit-form";

export const metadata: Metadata = {
  title: "Edit figure",
  robots: { index: false, follow: false },
};

/**
 * Editing a figure, for moderators and admins.
 *
 * A static frame, like the moderation page: who is asking is only known
 * inside the boundary, and everyone else gets a plain 404 -- no reason to
 * confirm the page exists to people who cannot use it.
 */
export default function EditFigurePage(props: PageProps<"/figures/[slug]/edit">) {
  return (
    <Suspense fallback={<EditFallback />}>
      <EditBody {...props} />
    </Suspense>
  );
}

function EditFallback() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl uppercase tracking-[0.14em]">Edit figure</h1>
      <div aria-hidden className="mt-6 h-96 rounded-lg border border-border-soft" />
    </div>
  );
}

async function EditBody({ params }: PageProps<"/figures/[slug]/edit">) {
  const [{ slug }, user] = await Promise.all([params, currentUser()]);
  if (!user) redirect(`/signin?callbackUrl=${encodeURIComponent(`/figures/${slug}/edit`)}`);
  if (!canEditFigures(user.role)) notFound();

  const figure = await prisma.figure.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      supersededBy: { select: { slug: true } },
      name: true,
      nameJa: true,
      category: true,
      status: true,
      scale: true,
      heightMm: true,
      releaseDate: true,
      releaseDatePrecision: true,
      msrpAmount: true,
      msrpCurrency: true,
      manufacturer: { select: { name: true } },
      characters: { select: { name: true }, orderBy: { name: "asc" } },
      identifiers: { where: { kind: "JAN" }, select: { value: true }, orderBy: { id: "asc" }, take: 1 },
      fieldLocks: { select: { field: true, note: true, createdAt: true, lockedBy: { select: { username: true } } } },
    },
  });
  if (!figure) notFound();
  // A folded entry is edited where it now lives.
  if (figure.supersededBy) redirect(`/figures/${figure.supersededBy.slug}/edit`);

  const locked = Object.fromEntries(
    figure.fieldLocks.map((l) => [
      l.field,
      [l.lockedBy?.username ? `@${l.lockedBy.username}` : null, l.note, l.createdAt.toISOString().slice(0, 10)]
        .filter(Boolean)
        .join(" · "),
    ]),
  );

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl uppercase tracking-[0.14em]">
          <PencilLine className="size-5" />
          Edit figure
        </h1>
        <p className="mt-1 text-sm text-muted">
          <Link href={`/figures/${figure.slug}`} className="hover:text-foreground hover:underline">
            {figure.name}
          </Link>
        </p>
      </header>
      <FigureEditForm
        figureId={figure.id}
        slug={figure.slug}
        values={formValues({ ...figure, jan: figure.identifiers[0]?.value ?? null })}
        locked={locked}
      />
    </div>
  );
}
