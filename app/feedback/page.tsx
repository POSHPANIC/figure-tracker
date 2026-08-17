import type { Metadata } from "next";
import { currentUser } from "@/auth";
import { prisma } from "@/lib/prisma";
import { currentFieldValues } from "@/lib/figure-fields";
import { SubmissionForm } from "@/components/submission-form";
import { ProsePage, Section } from "@/components/prose";
import { CONTACT_EMAIL, SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: "Feedback",
  description: `Report a bug, suggest a figure, or tell us what ${SITE_NAME} is getting wrong.`,
};

type Kind = "FEEDBACK" | "BUG" | "FIGURE" | "EDIT";

/** Accepts ?kind=bug so other pages can link straight to the right form. */
function parseKind(value: string | string[] | undefined): Kind {
  const first = Array.isArray(value) ? value[0] : value;
  switch (first?.toUpperCase()) {
    case "BUG":
      return "BUG";
    case "FIGURE":
      return "FIGURE";
    case "EDIT":
      return "EDIT";
    default:
      return "FEEDBACK";
  }
}

export default async function FeedbackPage({ searchParams }: PageProps<"/feedback">) {
  const [sp, user] = await Promise.all([searchParams, currentUser()]);
  const page = Array.isArray(sp.page) ? sp.page[0] : sp.page;

  // Corrections arrive from a figure's own page, which passes its slug. Look it
  // up rather than trusting a name in the query string — the id is what the
  // submission is stored against, and it should be one we actually have.
  const slug = Array.isArray(sp.figure) ? sp.figure[0] : sp.figure;
  const row = slug
    ? await prisma.figure.findUnique({
        where: { slug },
        select: {
          id: true,
          name: true,
          scale: true,
          heightMm: true,
          msrpAmount: true,
          msrpCurrency: true,
          releaseDate: true,
          manufacturer: { select: { name: true } },
          series: { select: { name: true } },
          characters: { select: { name: true } },
          _count: { select: { images: true } },
        },
      })
    : null;

  // The form is prefilled with what the page currently says, so a correction
  // means editing one value rather than retyping the lot — and it makes the
  // gaps visible, which is half of what prompts someone to fill them in.
  const figure = row
    ? {
        id: row.id,
        name: row.name,
        current: currentFieldValues(row),
        hasImage: row._count.images > 0,
      }
    : null;

  return (
    <ProsePage
      title="Feedback"
      intro="Found something broken, spotted a figure we're missing, or just have a thought? This goes straight to a person."
    >
      <SubmissionForm
        initialKind={parseKind(sp.kind)}
        initialPageUrl={page}
        figure={figure}
        signedIn={user !== null}
      />

      <Section title="What happens next">
        <p>
          Everything sent here lands in a queue that gets read. Missing figures are checked
          against the manufacturer or a retailer before they go in — we&apos;d rather add one
          figure correctly than ten from guesswork.
        </p>
        <p>
          Nothing you send changes what the site shows on its own. Prices come from marketplace
          data, and a person decides what to do with a report.
        </p>
        <p>
          Prefer email? <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent hover:underline">{CONTACT_EMAIL}</a>{" "}
          reaches the same place. Rights holders and takedown requests should use email — those
          are handled first.
        </p>
      </Section>
    </ProsePage>
  );
}
