import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { List, ProsePage, Section } from "@/components/prose";
import { CONTACT_EMAIL, SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact",
  description: `Get in touch with ${SITE_NAME} — corrections, takedown requests, press enquiries.`,
};

export default function ContactPage() {
  return (
    <ProsePage
      title="Contact"
      intro="One address, read by a person. No ticket system."
    >
      <Section>
        <a
          href={`mailto:${CONTACT_EMAIL}`}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm font-medium transition hover:border-accent/60 hover:bg-surface-2"
        >
          <Mail className="size-4 text-accent" />
          {CONTACT_EMAIL}
        </a>
      </Section>

      <Section title="Corrections">
        <p>
          Wrong manufacturer, wrong scale, a figure filed under the wrong character, or a price
          that looks obviously off — please say. A price reference is only worth anything if
          it's right, and mistakes are easier to fix than to notice.
        </p>
        <p>
          A link to the page and a line about what's wrong is plenty. There's also a{" "}
          <a href="/feedback" className="text-accent hover:underline">
            feedback form
          </a>{" "}
          if you'd rather not email — same queue, and it takes bug reports and missing figures
          too.
        </p>
      </Section>

      <Section title="Rights holders">
        <p>
          If you're a manufacturer, retailer or photographer and something here shouldn't be:
        </p>
        <List>
          <li>
            <strong>Images.</strong> Marketplace listing photos are shown alongside a link to the
            listing they belong to. Catalogue photos are used with permission and credited. If
            an image is yours and you'd rather it wasn't here, tell us and it comes down — no
            argument, no process.
          </li>
          <li>
            <strong>Data.</strong> Prices come from public marketplace listings. If you believe
            something is being used improperly, get in touch and we'll sort it out.
          </li>
        </List>
        <p>
          Requests from rights holders are handled first, and quickly.
        </p>
      </Section>

      <Section title="Press and partnerships">
        <p>
          Writing about the hobby, or a retailer interested in a data feed or affiliate
          arrangement — same address. {SITE_NAME} sends buyers toward listings rather than
          competing with anyone.
        </p>
      </Section>

      <Section title="Your account and data">
        <p>
          To get a copy of what's stored about you, or to have your account deleted, email from
          the address you signed up with. See the{" "}
          <a href="/privacy" className="text-accent hover:underline">
            privacy policy
          </a>{" "}
          for what's held and how long.
        </p>
      </Section>

      <Section title="Automated traffic">
        <p>
          If you operate a site {SITE_NAME} fetches data from and you'd like the rate reduced,
          restricted, or stopped altogether, mail us and it will be. Requests are honoured
          without needing a reason.
        </p>
      </Section>
    </ProsePage>
  );
}
