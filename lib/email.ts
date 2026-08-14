import { SITE_NAME } from "./site";

/**
 * Transactional email.
 *
 * Currently only sign-in links. Price alerts will use the same path, which is
 * half the reason for doing email now rather than later — the alert feature
 * then needs a template, not new infrastructure.
 *
 * In development with no API key set, links are printed to the terminal instead
 * of sent. That means a fresh clone can exercise the whole sign-in flow without
 * anyone registering for an email service, in the same spirit as the local
 * development login.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function isEmailConfigured(): boolean {
  return Boolean(process.env.AUTH_RESEND_KEY && process.env.EMAIL_FROM);
}

export type MagicLinkParams = {
  to: string;
  url: string;
  /** How long the link stays valid, for the copy. */
  expiresInMinutes: number;
};

/**
 * Send a sign-in link.
 *
 * Throws on a real send failure so Auth.js shows the user an error rather than
 * a "check your inbox" message for mail that was never sent.
 */
export async function sendMagicLink({ to, url, expiresInMinutes }: MagicLinkParams): Promise<void> {
  if (!isEmailConfigured()) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Email sign-in is not configured: set AUTH_RESEND_KEY and EMAIL_FROM.",
      );
    }

    // Development fallback. Deliberately noisy — it's easy to miss a link in
    // a wall of request logs.
    console.log(
      [
        "",
        "┌─────────────────────────────────────────────────────────────",
        `│ Sign-in link for ${to}`,
        "│",
        `│ ${url}`,
        "│",
        "│ (printed because AUTH_RESEND_KEY isn't set — development only)",
        "└─────────────────────────────────────────────────────────────",
        "",
      ].join("\n"),
    );
    return;
  }

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to,
      subject: `Sign in to ${SITE_NAME}`,
      html: magicLinkHtml(url, expiresInMinutes),
      text: magicLinkText(url, expiresInMinutes),
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Resend rejected the message (${res.status}): ${detail.slice(0, 300)}`);
  }
}

/**
 * Plain-text alternative.
 *
 * Not optional: mail clients that strip HTML would otherwise show an empty
 * message, and spam filters treat HTML-only mail with suspicion.
 */
function magicLinkText(url: string, expiresInMinutes: number): string {
  return [
    `Sign in to ${SITE_NAME}`,
    "",
    "Open this link to sign in:",
    url,
    "",
    `The link expires in ${expiresInMinutes} minutes and can only be used once.`,
    "",
    "If you didn't request this, you can ignore this email — nobody can sign in",
    "without opening the link above.",
  ].join("\n");
}

/**
 * Deliberately plain HTML: tables and inline styles, no external CSS or images.
 * Mail clients are not browsers, and an email that renders as a wall of broken
 * layout in Outlook is worse than one that looks unremarkable everywhere.
 */
function magicLinkHtml(url: string, expiresInMinutes: number): string {
  const escapedUrl = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f5f6fa;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#12141c;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e2e5ee;">
      <tr>
        <td style="padding:28px;">
          <h1 style="margin:0 0 8px;font-size:19px;font-weight:600;">Sign in to ${SITE_NAME}</h1>
          <p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:#646c80;">
            Click the button below and you'll be signed in. No password needed.
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td style="border-radius:8px;background:#5b3df5;">
                <a href="${escapedUrl}"
                   style="display:inline-block;padding:11px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">
                  Sign in
                </a>
              </td>
            </tr>
          </table>
          <p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:#646c80;">
            This link expires in ${expiresInMinutes} minutes and works once.
          </p>
          <p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:#646c80;">
            If you didn't request it, ignore this email — nobody can sign in
            without opening the link.
          </p>
          <p style="margin:20px 0 0;padding-top:16px;border-top:1px solid #e2e5ee;font-size:11px;line-height:1.5;color:#8b93a7;word-break:break-all;">
            Button not working? Paste this into your browser:<br />${escapedUrl}
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
