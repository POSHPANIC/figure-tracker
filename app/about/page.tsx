import Link from "next/link";
import type { Metadata } from "next";
import { Callout, List, ProsePage, Section } from "@/components/prose";
import { CONTACT_EMAIL, SITE_NAME } from "@/lib/site";
import { getCatalogTotals } from "@/lib/queries";

export const metadata: Metadata = {
  title: "About",
  description: `How ${SITE_NAME} works out what an anime figure is worth, and where the numbers come from.`,
};

export default async function AboutPage() {
  const totals = await getCatalogTotals();

  return (
    <ProsePage
      title={`About ${SITE_NAME}`}
      intro="A free price reference for anime figure collectors."
    >
      <Section>
        <p>
          Figures are hard to price. The same character gets released a dozen times, asking
          prices on the secondary market vary wildly, and there's no obvious way to tell whether
          the one you're looking at is a fair deal or twice what it should be.
        </p>
        <p>
          {SITE_NAME} tracks what figures actually sell for, so you can answer two questions:
          is this a reasonable price, and what is the shelf behind me worth?
        </p>
      </Section>

      <Section title="Where the numbers come from">
        <p>Three sources, and it's worth knowing the difference:</p>
        <List>
          <li>
            <strong>Live listings</strong> come from eBay's official API. These are asking
            prices — what someone hopes to get, which is not the same as what things sell for.
          </li>
          <li>
            <strong>Completed sales</strong> are the ones that matter, and the hardest to
            obtain. eBay restricts access to sold-price data, and our application is pending.
          </li>
          <li>
            <strong>Community reports</strong> — collectors telling us what they actually paid.
            Screened before they count; see below.
          </li>
        </List>
        {totals.sales === 0 && (
          <Callout>
            <strong>Right now there is no sale history at all.</strong> The catalogue is live and
            listings are real, but price charts will stay empty until sold-price data starts
            arriving. We'd rather show nothing than invent a number.
          </Callout>
        )}
      </Section>

      <Section title="How market value is calculated">
        <p>
          The <strong>median</strong> of the last 30 days of sales for a figure in new condition
          — not the average. One collector overpaying by $2,000 shouldn't move a $200 figure,
          and with a median it doesn't.
        </p>
        <p>
          Every chart point shows how many sales it's built from. A price derived from one sale
          is nearly meaningless and the tooltip says so. Where a figure has no recent sales, the
          value is blank rather than a stale number from months ago.
        </p>
        <p>
          Prices are converted to your chosen currency using the rate on the day each sale
          happened, so historical prices don't shift around as exchange rates move. Manufacturer
          list prices are always shown in the currency they were set in.
        </p>
      </Section>

      <Section title="Community reports">
        <p>
          Anyone signed in can report a sale. Since those reports feed a public price index,
          they're checked before they count: rate limited per person, validated, and compared
          against what's already known about that figure in that condition. Anything unusual
          waits for a moderator and doesn't affect prices in the meantime.
        </p>
        <p>
          The thresholds lean toward holding things back. A delayed report costs someone a little
          patience; a wrong one corrupts a number people use to decide what to pay.
        </p>
      </Section>

      <Section title="What this isn't">
        <List>
          <li>
            <strong>Not an appraisal.</strong> Values are estimates from public sales data.
            Condition, box state, edition and timing all move real prices in ways we can't see.
          </li>
          <li>
            <strong>Not a shop.</strong> Nothing is sold here. Listing links go to the
            marketplace hosting them.
          </li>
          <li>
            <strong>Not affiliated</strong> with any manufacturer or retailer.
          </li>
        </List>
      </Section>

      <Section title="Catalogue">
        <p>
          Currently <strong>{totals.figures.toLocaleString()}</strong>{" "}
          {totals.figures === 1 ? "figure" : "figures"}, growing. Series and character data comes
          from AniList; figure details are maintained by hand.
        </p>
        <p>
          Spotted something wrong? <Link href="/contact" className="text-accent hover:underline">Tell us</Link> —
          corrections are welcome and usually quick to make.
        </p>
      </Section>

      <Section title="Who runs it">
        <p>
          A small independent project, built because the tool didn't exist. It's free, carries no
          advertising, and requires no account to browse.
        </p>
        <p>
          Questions, corrections or press enquiries:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent hover:underline">
            {CONTACT_EMAIL}
          </a>
        </p>
      </Section>
    </ProsePage>
  );
}
