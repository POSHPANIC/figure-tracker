"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentUser, requireUser } from "@/auth";
import { prisma } from "@/lib/prisma";
import { clientIp, LIMITS } from "@/lib/rate-limit";
import { rateLimit } from "@/lib/rate-limit-store";
import type { ActionResult } from "./collection";
import type { SubmissionKind } from "@/lib/generated/prisma/enums";

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

const KINDS = ["FEEDBACK", "BUG", "FIGURE"] as const;

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
      .min(10, "Please add a little more detail — a sentence or two is plenty.")
      .max(4000, "That's longer than this form can take. Please email us instead."),
    pageUrl: optionalText(500),
    figureName: optionalText(200),
    manufacturer: optionalText(120),
    series: optionalText(120),
    referenceUrl: optionalUrl,
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
  .refine((v) => v.kind !== "FIGURE" || Boolean(v.figureName), {
    message: "Please tell us the figure's name.",
    path: ["figureName"],
  });

/** Fields that only make sense for one kind are dropped for the others. */
function fieldsFor(kind: SubmissionKind, input: z.infer<typeof submissionSchema>) {
  return {
    pageUrl: kind === "BUG" ? (input.pageUrl ?? null) : null,
    figureName: kind === "FIGURE" ? (input.figureName ?? null) : null,
    manufacturer: kind === "FIGURE" ? (input.manufacturer ?? null) : null,
    series: kind === "FIGURE" ? (input.series ?? null) : null,
    referenceUrl: kind === "FIGURE" ? (input.referenceUrl ?? null) : null,
  };
}

const THANKS: Record<SubmissionKind, string> = {
  FEEDBACK: "Thanks — that's been added to the queue and a person will read it.",
  BUG: "Thanks for reporting it. We'll take a look, and fixes usually go out the same week.",
  FIGURE:
    "Thanks. We'll check the product exists and get it into the catalogue — usually within a few days.",
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

  await prisma.submission.create({
    data: {
      kind: input.kind,
      details: input.details,
      contactEmail: input.contactEmail ?? null,
      userId: user?.id ?? null,
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
