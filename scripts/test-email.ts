import "dotenv/config";
import { SITE_NAME } from "../lib/site";

/**
 * Send one real email through the same path sign-in links use.
 *
 * "The email never arrived" has two very different causes, and the sign-in
 * screen cannot tell them apart: either Resend refused the message, or Resend
 * accepted it and something between there and the inbox dropped or filed it.
 * The first is a configuration error and shows up in the API response; the
 * second is a deliverability problem and shows up in a spam folder.
 *
 * This prints exactly what Resend said, so the two stop looking alike.
 *
 *   npm run email:test -- you@example.com
 */

async function main() {
  const to = process.argv[2];

  if (!to || !to.includes("@")) {
    console.error("\nUsage: npm run email:test -- you@example.com\n");
    process.exit(1);
  }

  const key = process.env["AUTH_RESEND_KEY"];
  const from = process.env["EMAIL_FROM"];

  console.log("");
  console.log(`  from      ${from ?? "(EMAIL_FROM not set)"}`);
  console.log(`  to        ${to}`);
  console.log(`  api key   ${key ? `present (${key.length} chars)` : "MISSING"}`);
  console.log("");

  if (!key || !from) {
    console.error("  Set AUTH_RESEND_KEY and EMAIL_FROM in .env first.\n");
    process.exit(1);
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to,
      subject: `${SITE_NAME} delivery test`,
      text:
        `This is a delivery test for ${SITE_NAME}.\n\n` +
        `It went out through the same sender and API key as sign-in links, so if ` +
        `this arrives and a sign-in link does not, the difference is the message, ` +
        `not the configuration.\n\n` +
        `Check the spam folder before concluding it did not arrive.\n`,
    }),
  });

  const body = await res.text();

  if (!res.ok) {
    console.log(`  ✗ Resend refused it (HTTP ${res.status})`);
    console.log(`    ${body.slice(0, 400)}\n`);
    if (/not verified|domain/i.test(body)) {
      console.log("    The sending domain is not verified for this account.");
      console.log("    Resend dashboard → Domains → check figureindex.com shows Verified.\n");
    }
    process.exit(1);
  }

  let id = "";
  try {
    id = (JSON.parse(body) as { id?: string }).id ?? "";
  } catch {
    /* the id is a convenience, not the point */
  }

  console.log("  ✓ Resend accepted the message" + (id ? ` (id ${id})` : ""));
  console.log("");
  console.log("    That means sending works. If it does not reach the inbox now,");
  console.log("    the problem is delivery, not configuration:");
  console.log("");
  console.log("      1. Check the spam folder — a new domain with no DMARC record");
  console.log("         is the single most common reason for landing there.");
  console.log("      2. Resend dashboard → Emails shows what happened after this");
  console.log("         hand-off: delivered, bounced, or complained.");
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
