import type { Metadata } from "next";
import { Callout, List, ProsePage, Section } from "@/components/prose";
import { CONTACT_EMAIL, SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy",
  description: `What ${SITE_NAME} stores, why, and for how long.`,
};

export default function PrivacyPage() {
  return (
    <ProsePage
      title="Privacy"
      intro="What's stored, why, and for how long. Written to be read, not to be survived."
      updated="2026-08-14"
    >
      <Section>
        <Callout>
          <strong>You can browse the entire site without an account.</strong> Nothing below
          applies until you choose to sign in. There is no advertising, no analytics, and no
          tracking of any kind.
        </Callout>
      </Section>

      <Section title="If you don't sign in">
        <p>Two things are stored, both briefly and neither identifying you personally:</p>
        <List>
          <li>
            <strong>Your IP address</strong>, to rate limit the search endpoint. It's kept for up
            to 24 hours and then deleted automatically. This exists to stop one person hammering
            the database, not to track anyone.
          </li>
          <li>
            <strong>Your currency preference</strong>, in a cookie, if you change it from the
            default. That's the only thing that cookie holds.
          </li>
        </List>
        <p>
          Our host (Vercel) keeps standard server logs of requests, as any web host does.
        </p>
      </Section>

      <Section title="If you sign in">
        <p>Signing in with Discord or an email link stores:</p>
        <List>
          <li>
            <strong>Your email address.</strong> Required — it's how your account is identified.
          </li>
          <li>
            <strong>Your Discord display name and avatar</strong>, if you sign in that way, plus
            the tokens needed to keep that connection working.
          </li>
          <li>
            <strong>A username and bio</strong>, only if you choose to set them.
          </li>
        </List>
        <p>
          There is no password, so there's nothing to leak, reset, or reuse elsewhere.
        </p>
      </Section>

      <Section title="What you add">
        <List>
          <li>
            <strong>Your collection</strong> — which figures, condition, quantity, what you paid,
            when you bought them, and any notes.
          </li>
          <li>
            <strong>Your wishlist</strong> — figures and how badly you want them.
          </li>
          <li>
            <strong>Sale reports</strong> — price, condition, date, and optionally a link.
          </li>
        </List>
      </Section>

      <Section title="What other people can see">
        <p>
          <strong>Your profile is private by default.</strong> Nothing about your collection is
          visible to anyone until you switch it on in settings.
        </p>
        <p>If you do make it public, visitors see which figures you own and their market value.</p>
        <Callout>
          <strong>What you paid is never shown publicly.</strong> Not on your profile, not
          anywhere, whatever your settings. Neither is your profit or loss. Those exist for you
          alone.
        </Callout>
        <p>
          Sale reports appear on the figure's page attributed to your username, because a price
          index that can't be traced isn't worth much. The report shows a price, condition and
          date — nothing about you beyond the name you chose.
        </p>
      </Section>

      <Section title="Who else is involved">
        <p>
          {SITE_NAME} doesn't sell data or share it for marketing. These companies are involved
          in running the site:
        </p>
        <List>
          <li>
            <strong>Vercel</strong> — hosting. Processes every request, keeps server logs.
          </li>
          <li>
            <strong>Neon</strong> — the database where everything above is stored.
          </li>
          <li>
            <strong>Resend</strong> — sends sign-in emails. Sees your email address.
          </li>
          <li>
            <strong>Discord</strong> — only if you sign in with it, and only what you approve.
          </li>
        </List>
        <p>
          One thing worth knowing that most sites don't mention:{" "}
          <strong>listing photos are loaded directly from eBay</strong> rather than copied here.
          That means your browser contacts eBay when you view a figure page, and eBay can see
          your IP address as a result — the same as if you'd visited a listing. We do this
          because copying their images would be a licensing problem, but it's your information
          and you should know.
        </p>
      </Section>

      <Section title="How long things are kept">
        <List>
          <li>
            <strong>Account, collection and wishlist</strong> — until you delete your account.
          </li>
          <li>
            <strong>Rate-limit records (IP addresses)</strong> — up to 24 hours.
          </li>
          <li>
            <strong>Sign-in links</strong> — 15 minutes, and they work once.
          </li>
          <li>
            <strong>Sale reports</strong> — kept indefinitely, because they're part of the price
            history other people rely on. If you delete your account, your reports stay but stop
            being linked to you: they become anonymous data points rather than yours.
          </li>
        </List>
      </Section>

      <Section title="Cookies">
        <p>
          Only what's needed to work. A session cookie so you stay signed in, a short-lived one
          during sign-in for security, and your currency preference.
        </p>
        <p>
          <strong>There's no cookie banner because there's nothing to consent to.</strong> No
          advertising cookies, no analytics, nothing shared with anyone else.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          Email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent hover:underline">
            {CONTACT_EMAIL}
          </a>{" "}
          from your registered address and you can:
        </p>
        <List>
          <li>Get a copy of everything stored about you</li>
          <li>Have anything corrected</li>
          <li>Have your account and its data deleted</li>
        </List>
        <p>
          If you're in the UK or EU, the GDPR gives you these rights and we'll honour them
          whether it applies to you or not. No account is needed to browse, so declining to
          create one is always an option.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          If this changes in a way that affects what's collected or who sees it, the date at the
          top changes and anyone with an account gets an email. Quietly broadening what we do
          with your data isn't something we'd do.
        </p>
      </Section>
    </ProsePage>
  );
}
