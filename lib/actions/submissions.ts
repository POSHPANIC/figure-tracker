"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentUser, requireUser } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recomputeFigureStatsFor } from "@/lib/ingest/aggregate";
import { clientIp, LIMITS } from "@/lib/rate-limit";
import { buildReference } from "@/lib/sales/reference";
import { LIMITS as SALE_LIMITS, screenReportedSale } from "@/lib/sales/validate";
import { toUsd } from "@/lib/ingest/fx";
import { normalizeCondition } from "@/lib/ingest/match";
import { rateLimit } from "@/lib/rate-limit-store";
import type { ActionResult } from "./collection";
import type { ItemCondition, SubmissionKind } from "@/lib/generated/prisma/enums";
import {
  EDITABLE_FIELD_KEYS,
  currentFieldValues,
  type EditableFieldKey,
} from "@/lib/figure-fields";

/**
 * Feedback, bug reports, and requests to add a figure.
 *
 * Deliberately open to anyone, signed in or not. Nothing submitted here changes
 * what the site publishes — a person reads it and decides — so the damage a bad
 * submission can do is one wasted minute, not a wrong price. That's a very
 * different risk from letting the public write prices directly, and it's why
 * this can accept anonymous input where sale reporting couldn't.
 *
 * What it still needs is a cap on volume, since an open form with no account
 * behind it is an obvious target for whoever wants to fill a table with junk.
 * Hence the per-IP rate limit.
 */

export type SubmissionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

const KINDS = ["FEEDBACK", "BUG", "FIGURE", "EDIT", "SALE"] as const;

/** Trims, and turns "" into undefined so empty inputs don't become empty rows. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || /^https?:\/\/\S+$/.test(v), {
    message: "Links need to start with http:// or https://",
  });

const submissionSchema = z
  .object({
    kind: z.enum(KINDS),
    details: z
      .string()
      .trim()
      .max(4000, "That's longer than this form can take. Please email us instead."),
    pageUrl: optionalText(500),
    figureId: optionalText(40),
    imageUrl: optionalUrl,
    // Every editable field arrives on every correction, prefilled with what
    // the page already says. Which of them changed is worked out here rather
    // than taken on trust — see proposedChanges.
    ...Object.fromEntries(EDITABLE_FIELD_KEYS.map((k) => [k, optionalText(200)])),
    saleAmount: optionalText(20),
    saleCurrency: optionalText(3),
    saleDate: optionalText(10),
    saleCondition: optionalText(20),
    saleUrl: optionalUrl,
    contactEmail: z
      .string()
      .trim()
      .max(320)
      .optional()
      .transform((v) => (v ? v : undefined))
      .refine((v) => v === undefined || z.string().email().safeParse(v).success, {
        message: "That doesn't look like an email address.",
      }),
    // Honeypot. Real people never see it, so anything in it came from a bot.
    // Accepts any value on purpose — rejecting it here would surface a
    // validation error, which tells whoever wrote the bot exactly which field
    // gave them away. The discard happens after parsing instead.
    website: z.string().optional(),
  })
  .refine((v) => v.kind !== "FIGURE" || Boolean(editable(v, "name")), {
    message: "Please tell us the figure's name.",
    path: ["name"],
  })
  .refine((v) => v.kind === "EDIT" || v.kind === "SALE" || v.details.length >= 10, {
    // A correction can be nothing but a changed field — "230" in the height
    // box says everything it needs to. Every other kind is only words, so
    // there has to be enough of them to act on.
    message: "Please add a little more detail — a sentence or two is plenty.",
    path: ["details"],
  })
  .refine((v) => v.kind !== "SALE" || Boolean(v.figureId && v.saleAmount && v.saleDate), {
    message: "A sale needs the figure, what it sold for, and when.",
    path: ["saleAmount"],
  })
  .refine((v) => v.kind !== "EDIT" || Boolean(v.figureId), {
    // The form only offers this kind from a figure's own page, so a missing
    // id means the request did not come from there.
    message: "We could not tell which figure this is about.",
    path: ["figureId"],
  });

/**
 * Read one of the editable fields off a parsed submission.
 *
 * Their keys are spread into the schema from EDITABLE_FIELD_KEYS so that the
 * list stays the single source of truth, and the cost of that is they are not
 * statically known on the parsed type. One narrow accessor beats a cast at
 * every call site.
 */
function editable(input: unknown, key: EditableFieldKey): string | undefined {
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Fields that only make sense for one kind are dropped for the others. */
function fieldsFor(kind: SubmissionKind, input: z.infer<typeof submissionSchema>) {
  return {
    pageUrl: kind === "BUG" ? (input.pageUrl ?? null) : null,
    // The headline two keep their own columns because the queue leads with
    // them; everything else a figure request carries now rides in
    // proposedFields, the same place a correction's values go.
    figureName: kind === "FIGURE" ? (editable(input, "name") ?? null) : null,
    manufacturer: kind === "FIGURE" ? (editable(input, "manufacturer") ?? null) : null,
    // Series is no longer asked for — the site stopped showing it when
    // browsing moved to franchises.
    series: null,
    referenceUrl: kind === "FIGURE" ? (editable(input, "storeUrl") ?? null) : null,
    // Both kinds are about one particular figure. A sale report without it is
    // unpublishable — there is nothing to attach the price to.
    figureId: kind === "EDIT" || kind === "SALE" ? (input.figureId ?? null) : null,
  };
}

const THANKS: Record<SubmissionKind, string> = {
  FEEDBACK: "Thanks — that's been added to the queue and a person will read it.",
  BUG: "Thanks for reporting it. We'll take a look, and fixes usually go out the same week.",
  FIGURE:
    "Thanks. We'll check the product exists and get it into the catalogue — usually within a few days.",
  EDIT:
    "Thanks. We'll check this against the manufacturer before changing anything on the page.",
  SALE:
    "Thanks. A person checks every reported sale before it reaches a price chart, so this won't appear straight away.",
};

export async function createSubmission(formData: FormData): Promise<SubmissionResult> {
  const parsed = submissionSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  const input = parsed.data;

  // Silently accept and discard bot submissions. Telling a script it failed
  // just teaches whoever wrote it to leave the field alone next time.
  if (input.website) return { ok: true, message: THANKS[input.kind] };

  const user = await currentUser();

  // Signed-in users are already accountable and rate-limited by having an
  // account at all; anonymous ones get capped by IP.
  if (!user) {
    const ip = clientIp(await headers());
    const limited = await rateLimit(`submission:${ip}`, LIMITS.write);
    if (!limited.allowed) {
      return {
        ok: false,
        error: "That's a lot of submissions at once. Please try again in a minute.",
      };
    }
  }

  // Corrections are checked against the figure itself: it has to exist, the
  // changes have to be real changes, and an image is only wanted where there
  // isn't one.
  let proposed: Record<string, string> | null = null;
  let imageUrl = input.kind === "EDIT" ? (input.imageUrl ?? null) : null;

  // A figure request has no figure to compare against, so everything typed is
  // a proposal. It goes to the same place a correction's values go, which is
  // what lets one queue render both.
  if (input.kind === "FIGURE") {
    const filled: Record<string, string> = {};
    for (const key of EDITABLE_FIELD_KEYS) {
      const value = editable(input, key as EditableFieldKey);
      if (value) filled[key] = value;
    }
    if (!filled.name) {
      return { ok: false, error: "A name is needed — everything else is a bonus." };
    }
    if (Object.keys(filled).length > 0) proposed = filled;
  }

  if ((input.kind === "EDIT" || input.kind === "SALE") && input.figureId) {
    const figure = await prisma.figure.findUnique({
      where: { id: input.figureId },
      select: {
        id: true,
        name: true,
        scale: true,
        heightMm: true,
        msrpAmount: true,
        msrpCurrency: true,
        releaseDate: true,
        manufacturer: { select: { name: true } },
        characters: { select: { name: true } },
        _count: { select: { images: true } },
        fieldLocks: { select: { field: true } },
      },
    });
    if (!figure) {
      return {
        ok: false,
        error: "That figure no longer exists. Try again from its page.",
      };
    }

    // The form hides the image field once a figure has one, but the form is
    // not the guard — a submission can be made without it. Dropped rather
    // than refused: the rest of what they wrote is still worth having.
    if (figure._count.images > 0) imageUrl = null;

    const current = currentFieldValues(figure);
    // Confirmed fields are dropped here, not just hidden on the form. The
    // form is a courtesy; this is the rule.
    const confirmed = new Set(figure.fieldLocks.map((l) => l.field));
    const changed: Record<string, string> = {};
    for (const key of EDITABLE_FIELD_KEYS) {
      if (confirmed.has(key)) continue;
      const value = (input as Record<string, unknown>)[key];
      if (typeof value !== "string") continue;
      const next = value.trim();
      // Blank means "left alone", not "delete this". Removing a value is a
      // different request and one worth explaining in words.
      if (!next || next === current[key as EditableFieldKey].trim()) continue;
      changed[key] = next;
    }
    if (Object.keys(changed).length > 0) proposed = changed;

    if (input.kind === "EDIT" && !proposed && !imageUrl && input.details.trim().length < 10) {
      return {
        ok: false,
        error: "Nothing looks changed. Edit a field, add an image, or describe the problem.",
      };
    }
  }

  // A reported sale is checked for the mistakes that are unambiguous — a price
  // of zero, a date in the future — and otherwise stored with a note about
  // anything unusual. It is never published from here: only a moderator turns
  // one of these into a Sale row, which is the difference between this and the
  // version of the feature that had to be removed.
  let sale: {
    amount: number;
    currency: string;
    soldAt: Date;
    condition: ItemCondition;
    flag: string | null;
  } | null = null;

  if (input.kind === "SALE" && input.figureId) {
    const amount = Number(String(input.saleAmount).replace(/[^0-9.]/g, ""));
    const currency = (input.saleCurrency ?? "USD").toUpperCase().slice(0, 3);
    const soldAt = new Date(String(input.saleDate));

    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, error: "That price doesn't look like a number." };
    }
    if (Number.isNaN(soldAt.getTime())) {
      return { ok: false, error: "That date doesn't look right." };
    }
    if (soldAt.getTime() > Date.now()) {
      return { ok: false, error: "That sale is dated in the future." };
    }
    const oldest = new Date();
    oldest.setFullYear(oldest.getFullYear() - SALE_LIMITS.maxAgeYears);
    if (soldAt < oldest) {
      return { ok: false, error: `Sales older than ${SALE_LIMITS.maxAgeYears} years are outside what we track.` };
    }

    let amountUsd: number;
    try {
      amountUsd = (await toUsd(amount, currency)).amountUsd;
    } catch {
      return { ok: false, error: `We don't have an exchange rate for ${currency}.` };
    }
    if (amountUsd < SALE_LIMITS.hardMinUsd || amountUsd > SALE_LIMITS.hardMaxUsd) {
      return { ok: false, error: "That price is outside anything we can treat as a figure sale." };
    }

    const condition = normalizeCondition(input.saleCondition ?? null);
    const reference = await buildReference(input.figureId, condition);
    // Screening no longer decides whether it publishes — only what the
    // moderator gets told before they look.
    const { flagReason } = screenReportedSale(amountUsd, reference);
    sale = { amount, currency, soldAt, condition, flag: flagReason };
  }

  await prisma.submission.create({
    data: {
      kind: input.kind,
      details: input.details,
      contactEmail: input.contactEmail ?? null,
      userId: user?.id ?? null,
      imageUrl,
      proposedFields: proposed ?? undefined,
      saleAmount: sale?.amount ?? null,
      saleCurrency: sale?.currency ?? null,
      saleDate: sale?.soldAt ?? null,
      saleCondition: sale?.condition ?? null,
      saleUrl: input.kind === "SALE" ? (input.saleUrl ?? null) : null,
      saleFlag: sale?.flag ?? null,
      ...fieldsFor(input.kind, input),
    },
  });

  revalidatePath("/moderation");
  return { ok: true, message: THANKS[input.kind] };
}

// --- Moderation -----------------------------------------------------------

async function requireModerator() {
  const user = await requireUser();
  if (user.role !== "MODERATOR" && user.role !== "ADMIN") {
    throw new Error("You don't have permission to do that.");
  }
  return user;
}

const reviewSchema = z.object({
  submissionId: z.string().min(1),
  decision: z.enum(["RESOLVED", "DECLINED"]),
  note: z.string().trim().max(500).optional(),
});

/** Close a submission out. Kept, not deleted — the queue is also a record. */
export async function reviewSubmission(formData: FormData): Promise<ActionResult> {
  let moderator;
  try {
    moderator = await requireModerator();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not permitted." };
  }

  const parsed = reviewSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const submission = await prisma.submission.findUnique({
    where: { id: parsed.data.submissionId },
    select: { id: true },
  });
  if (!submission) return { ok: false, error: "Submission not found." };

  await prisma.submission.update({
    where: { id: submission.id },
    data: {
      status: parsed.data.decision,
      handledAt: new Date(),
      handledById: moderator.id,
      handlerNote: parsed.data.note || null,
    },
  });

  revalidatePath("/moderation");
  return { ok: true };
}

// --- Confirmed fields ------------------------------------------------------

const lockSchema = z.object({
  figureId: z.string().min(1),
  field: z.enum(EDITABLE_FIELD_KEYS as unknown as [string, ...string[]]),
  note: z.string().trim().max(300).optional(),
});

/**
 * Mark a field as checked and correct, closing it to further suggestions.
 *
 * The same handful of fields attract the same correction over and over —
 * usually where a retailer and the box disagree and the box is right. Without
 * somewhere to record that we looked, every moderator repeats the check and the
 * queue keeps filling with a claim that has already been settled.
 *
 * This says nothing about the value being unchangeable. It says a person
 * verified it against the manufacturer, and it can be unlocked by anyone who
 * finds otherwise — the row keeps who confirmed it and when, which is exactly
 * what you want when someone insists it is wrong.
 */
export async function lockFigureField(formData: FormData): Promise<ActionResult> {
  let moderator;
  try {
    moderator = await requireModerator();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not permitted." };
  }

  const parsed = lockSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { figureId, field, note } = parsed.data;

  const figure = await prisma.figure.findUnique({
    where: { id: figureId },
    select: { slug: true },
  });
  if (!figure) return { ok: false, error: "Figure not found." };

  // Confirming twice is not an error — a second moderator reaching the same
  // conclusion should not see a failure. Their note replaces the old one.
  await prisma.figureFieldLock.upsert({
    where: { figureId_field: { figureId, field } },
    create: { figureId, field, note: note || null, lockedById: moderator.id },
    update: { note: note || null, lockedById: moderator.id },
  });

  revalidatePath("/moderation");
  revalidatePath(`/figures/${figure.slug}`);
  return { ok: true };
}

/** Reopen a field to suggestions. A delete, so nothing lingers half-locked. */
export async function unlockFigureField(formData: FormData): Promise<ActionResult> {
  try {
    await requireModerator();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not permitted." };
  }

  const parsed = lockSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { figureId, field } = parsed.data;

  const figure = await prisma.figure.findUnique({
    where: { id: figureId },
    select: { slug: true },
  });
  if (!figure) return { ok: false, error: "Figure not found." };

  await prisma.figureFieldLock.deleteMany({ where: { figureId, field } });

  revalidatePath("/moderation");
  revalidatePath(`/figures/${figure.slug}`);
  return { ok: true };
}

/**
 * Publish a reported sale, and close the report.
 *
 * The only route from a community report into the price index, and it runs
 * under a moderator's account. Community reporting was removed once because a
 * report wrote straight into published prices; this is the same feature with a
 * person standing in that gap.
 */
export async function approveReportedSale(formData: FormData): Promise<ActionResult> {
  let moderator;
  try {
    moderator = await requireModerator();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not permitted." };
  }

  const id = String(formData.get("submissionId") ?? "");
  if (!id) return { ok: false, error: "Invalid request." };

  const report = await prisma.submission.findUnique({
    where: { id },
    select: {
      id: true, kind: true, status: true, figureId: true,
      saleAmount: true, saleCurrency: true, saleDate: true,
      saleCondition: true, saleUrl: true,
    },
  });
  if (!report || report.kind !== "SALE") return { ok: false, error: "Not a sale report." };
  if (report.status !== "OPEN") return { ok: false, error: "That report is already handled." };
  if (!report.figureId || !report.saleAmount || !report.saleDate) {
    return { ok: false, error: "That report is missing the figure, price or date." };
  }

  const source = await prisma.source.findUnique({ where: { key: "user" }, select: { id: true } });
  if (!source) return { ok: false, error: "The community source is missing." };

  const currency = report.saleCurrency ?? "USD";
  let converted;
  try {
    converted = await toUsd(Number(report.saleAmount), currency);
  } catch {
    return { ok: false, error: `No exchange rate available for ${currency}.` };
  }

  await prisma.sale.create({
    data: {
      sourceId: source.id,
      figureId: report.figureId,
      // Ties the published row back to the report it came from, so a sale that
      // later looks wrong can be traced to who reported it and who approved it.
      externalId: `submission:${report.id}`,
      title: null,
      url: report.saleUrl,
      condition: report.saleCondition ?? "UNKNOWN",
      amount: report.saleAmount,
      currency,
      amountUsd: converted.amountUsd,
      fxRate: converted.fxRate,
      soldAt: report.saleDate,
    },
  });

  await prisma.submission.update({
    where: { id: report.id },
    data: {
      status: "RESOLVED",
      handledAt: new Date(),
      handledById: moderator.id,
      handlerNote: "Approved and published.",
    },
  });

  // The figure's market value and chart are derived from sales, so they are
  // stale the moment one lands.
  await recomputeFigureStatsFor(report.figureId);
  revalidatePath("/moderation");
  return { ok: true };
}
