"use server";

import { revalidatePath, updateTag } from "next/cache";
import { requireUser } from "@/auth";
import { prisma } from "@/lib/prisma";
import { figureCacheTag } from "@/lib/queries";
import { rebuildSearchTextFor } from "@/lib/ingest/search-index";
import { slugify } from "@/lib/utils";
import { LOCK_KEY, canEditFigures, changedFields, parseEdit, type EditField } from "@/lib/figure-edit";

export type EditResult =
  | { ok: true; changed: EditField[] }
  | { ok: false; error: string; fieldErrors?: Partial<Record<EditField, string>> };

/** A slug no row of that table holds yet: "good-smile-company", then "-2". */
async function freeSlug(base: string, taken: (slug: string) => Promise<boolean>): Promise<string> {
  const root = slugify(base) || "item";
  for (let n = 1; ; n += 1) {
    const slug = n === 1 ? root : `${root}-${n}`;
    if (!(await taken(slug))) return slug;
  }
}

/**
 * Write an edit to a figure, as a moderator or admin.
 *
 * Every field the edit changed is locked to the editor, so the next import
 * cannot quietly put the old value back -- the same lock a moderator sets by
 * confirming a field. The slug is never changed: a rename keeps the page's
 * address, and every link to it.
 *
 * A manufacturer or character typed by name is matched to an existing one,
 * ignoring case, and created only when there is none.
 */
export async function editFigure(formData: FormData): Promise<EditResult> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Sign in first." };
  }
  // From the database, not the session: the sign-in token keeps whatever role
  // it was issued with, so a role taken away would otherwise keep working until
  // the token expired.
  const account = await prisma.user.findUnique({ where: { id: user.id }, select: { role: true, name: true, username: true } });
  if (!canEditFigures(account?.role)) return { ok: false, error: "You don't have permission to edit figures." };

  const figureId = String(formData.get("figureId") ?? "");
  const parsed = parseEdit(Object.fromEntries(formData.entries()));
  if (!parsed.ok) return { ok: false, error: "Some fields need fixing.", fieldErrors: parsed.errors };
  const edit = parsed.value;

  const figure = await prisma.figure.findUnique({
    where: { id: figureId },
    select: {
      id: true,
      slug: true,
      seriesId: true,
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
      series: { select: { id: true, franchiseId: true, franchise: { select: { name: true } } } },
      characters: { select: { id: true, name: true } },
      identifiers: { where: { kind: "JAN" }, select: { id: true, value: true }, orderBy: { id: "asc" } },
    },
  });
  if (!figure) return { ok: false, error: "That figure no longer exists." };

  const currentJan = figure.identifiers[0] ?? null;
  const changed = changedFields(
    { ...figure, franchise: figure.series?.franchise?.name ?? null, jan: currentJan?.value ?? null },
    edit,
  );
  if (changed.length === 0) return { ok: true, changed };

  // A barcode belongs to one figure. Taking one another figure holds would
  // silently send that figure's matches here.
  if (changed.includes("jan") && edit.jan) {
    const held = await prisma.figureIdentifier.findUnique({
      where: { kind_value: { kind: "JAN", value: edit.jan } },
      select: { figureId: true, figure: { select: { name: true } } },
    });
    if (held && held.figureId !== figure.id) {
      return { ok: false, error: "Some fields need fixing.", fieldErrors: { jan: `Already on "${held.figure.name}".` } };
    }
  }

  let manufacturerId: string | null | undefined;
  if (changed.includes("manufacturer")) {
    if (!edit.manufacturer) manufacturerId = null;
    else {
      const existing = await prisma.manufacturer.findFirst({
        where: { name: { equals: edit.manufacturer, mode: "insensitive" } },
        select: { id: true },
      });
      manufacturerId =
        existing?.id ??
        (
          await prisma.manufacturer.create({
            data: {
              name: edit.manufacturer,
              slug: await freeSlug(edit.manufacturer, async (s) => !!(await prisma.manufacturer.findUnique({ where: { slug: s } }))),
            },
            select: { id: true },
          })
        ).id;
    }
  }

  let characterIds: string[] | undefined;
  if (changed.includes("characters")) {
    characterIds = [];
    for (const name of edit.characters) {
      // The figure's own series first, since a name like "Saber" is many people.
      const matches = await prisma.character.findMany({
        where: { name: { equals: name, mode: "insensitive" } },
        select: { id: true, seriesId: true },
      });
      const match = matches.find((c) => c.seriesId === figure.seriesId) ?? matches[0];
      characterIds.push(
        match?.id ??
          (
            await prisma.character.create({
              data: {
                name,
                seriesId: figure.seriesId,
                slug: await freeSlug(name, async (s) => !!(await prisma.character.findUnique({ where: { slug: s } }))),
              },
              select: { id: true },
            })
          ).id,
      );
    }
  }

  // The franchise belongs to the series, so it changes for every figure in it --
  // the form says how many. A figure with no series joins one of the
  // franchise's own name, which is what makes it show under that franchise.
  let seriesForFigure: string | undefined;
  let seriesFranchise: { seriesId: string; franchiseId: string | null } | null = null;
  if (changed.includes("franchise")) {
    let franchiseId: string | null = null;
    if (edit.franchise) {
      const existing = await prisma.franchise.findFirst({
        where: { name: { equals: edit.franchise, mode: "insensitive" } },
        select: { id: true },
      });
      franchiseId =
        existing?.id ??
        (
          await prisma.franchise.create({
            data: {
              name: edit.franchise,
              slug: await freeSlug(edit.franchise, async (s) => !!(await prisma.franchise.findUnique({ where: { slug: s } }))),
            },
            select: { id: true },
          })
        ).id;
    }
    if (figure.series) {
      seriesFranchise = { seriesId: figure.series.id, franchiseId };
    } else if (edit.franchise && franchiseId) {
      const named = await prisma.series.findFirst({
        where: { name: { equals: edit.franchise, mode: "insensitive" } },
        select: { id: true, franchiseId: true },
      });
      seriesForFigure =
        named?.id ??
        (
          await prisma.series.create({
            data: {
              name: edit.franchise,
              franchiseId,
              slug: await freeSlug(edit.franchise, async (s) => !!(await prisma.series.findUnique({ where: { slug: s } }))),
            },
            select: { id: true },
          })
        ).id;
      if (named && !named.franchiseId) seriesFranchise = { seriesId: named.id, franchiseId };
    }
  }

  const locks = [...new Set(changed.map((f) => LOCK_KEY[f]).filter((k): k is string => !!k))];
  const note = `Edited by ${account?.username ?? account?.name ?? "an editor"}`;

  await prisma.$transaction([
    prisma.figure.update({
      where: { id: figure.id },
      data: {
        name: edit.name,
        nameJa: edit.nameJa,
        category: edit.category,
        status: edit.status,
        scale: edit.scale,
        heightMm: edit.heightMm,
        releaseDate: edit.releaseDate,
        releaseDatePrecision: edit.releaseDatePrecision,
        msrpAmount: edit.msrpAmount,
        msrpCurrency: edit.msrpCurrency,
        ...(manufacturerId !== undefined ? { manufacturerId } : {}),
        ...(characterIds ? { characters: { set: characterIds.map((id) => ({ id })) } } : {}),
        ...(seriesForFigure ? { seriesId: seriesForFigure } : {}),
      },
    }),
    ...(seriesFranchise
      ? [prisma.series.update({ where: { id: seriesFranchise.seriesId }, data: { franchiseId: seriesFranchise.franchiseId } })]
      : []),
    // The shown barcode, replaced in place; others the figure holds -- a
    // reissue's -- are left alone.
    ...(changed.includes("jan")
      ? currentJan && edit.jan
        ? [prisma.figureIdentifier.update({ where: { id: currentJan.id }, data: { value: edit.jan } })]
        : currentJan
          ? [prisma.figureIdentifier.delete({ where: { id: currentJan.id } })]
          : edit.jan
            ? [prisma.figureIdentifier.create({ data: { figureId: figure.id, kind: "JAN", value: edit.jan } })]
            : []
      : []),
    ...locks.map((field) =>
      prisma.figureFieldLock.upsert({
        where: { figureId_field: { figureId: figure.id, field } },
        create: { figureId: figure.id, field, note, lockedById: user.id },
        update: { note, lockedById: user.id },
      }),
    ),
  ]);

  // Names, characters and makers are what search reads.
  if (seriesForFigure || changed.some((f) => ["name", "nameJa", "manufacturer", "characters"].includes(f))) {
    await rebuildSearchTextFor(figure.id);
  }

  // The page reads through a cache tagged per figure; this is what makes the
  // editor see their change on the next load rather than an hour later.
  updateTag(figureCacheTag(figure.slug));
  revalidatePath(`/figures/${figure.slug}`);
  revalidatePath("/figures");
  return { ok: true, changed };
}

export type Suggestion = { value: string; note?: string };

/**
 * Names an editor might mean, for the edit form's dropdowns.
 *
 * Manufacturers and characters, because those are the two fields where typing
 * a name that already exists slightly differently creates a second one. Names
 * starting with what was typed come first, then the most used; characters
 * from the figure's own series ahead of namesakes from elsewhere, and each
 * with its series beside it, since "Saber" is several people.
 */
export async function suggestNames(
  field: "manufacturer" | "character" | "franchise",
  query: string,
  figureId?: string,
): Promise<Suggestion[]> {
  const user = await requireUser().catch(() => null);
  if (!user) return [];
  const account = await prisma.user.findUnique({ where: { id: user.id }, select: { role: true } });
  if (!canEditFigures(account?.role)) return [];

  const q = query.trim();
  if (!q) return [];
  const starts = (name: string) => name.toLowerCase().startsWith(q.toLowerCase());

  if (field === "franchise") {
    const rows = await prisma.franchise.findMany({
      where: { name: { contains: q, mode: "insensitive" } },
      select: { name: true, _count: { select: { series: true } } },
      take: 30,
    });
    return rows
      .sort((a, b) => Number(starts(b.name)) - Number(starts(a.name)) || b._count.series - a._count.series)
      .slice(0, 8)
      .map((r) => ({ value: r.name, note: `${r._count.series} series` }));
  }

  if (field === "manufacturer") {
    const rows = await prisma.manufacturer.findMany({
      where: { name: { contains: q, mode: "insensitive" } },
      select: { name: true, _count: { select: { figures: true } } },
      orderBy: { figures: { _count: "desc" } },
      take: 30,
    });
    return rows
      .sort((a, b) => Number(starts(b.name)) - Number(starts(a.name)))
      .slice(0, 8)
      .map((r) => ({ value: r.name, note: `${r._count.figures} figure${r._count.figures === 1 ? "" : "s"}` }));
  }

  const seriesId = figureId
    ? (await prisma.figure.findUnique({ where: { id: figureId }, select: { seriesId: true } }))?.seriesId ?? null
    : null;
  const rows = await prisma.character.findMany({
    where: { name: { contains: q, mode: "insensitive" } },
    select: { name: true, seriesId: true, series: { select: { name: true } }, _count: { select: { figures: true } } },
    orderBy: { figures: { _count: "desc" } },
    take: 40,
  });
  const rank = (r: (typeof rows)[number]) => (r.seriesId && r.seriesId === seriesId ? 2 : 0) + (starts(r.name) ? 1 : 0);
  return rows
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, 8)
    .map((r) => ({ value: r.name, note: r.series?.name ?? undefined }));
}
