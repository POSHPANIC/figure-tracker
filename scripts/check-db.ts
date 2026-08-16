import "dotenv/config";
import { Client } from "pg";

/**
 * Check a connection string before a deploy depends on it.
 *
 * `prisma migrate deploy` runs inside the Vercel build, so a bad
 * DIRECT_DATABASE_URL is discovered two minutes into a deploy, as an error code
 * with no context: P1013 for a malformed string, P1001 for one that connects
 * and is then refused, P1002 for one that reaches a connection pooler. Three
 * codes, three deploys, and none of them says which part of the URL is wrong.
 *
 * This asks the same questions in about two seconds, locally, and says what it
 * found. It prints scheme, host, database and user — never the password.
 *
 *   npm run db:check                 # checks DIRECT_DATABASE_URL, else DATABASE_URL
 *   npm run db:check -- --pooled     # checks DATABASE_URL instead
 */

const WANT_POOLED = process.argv.includes("--pooled");

function pick(): { name: string; url: string } {
  const name =
    WANT_POOLED || !process.env["DIRECT_DATABASE_URL"]?.trim()
      ? "DATABASE_URL"
      : "DIRECT_DATABASE_URL";
  const url = process.env[name]?.trim();
  if (!url) {
    console.error(`${name} is not set.\n`);
    console.error("Set it for one command without putting it in a file:\n");
    console.error(`  $env:DIRECT_DATABASE_URL="postgresql://..."; npm run db:check\n`);
    process.exit(1);
  }
  return { name, url };
}

/** Everything worth reporting about a URL, minus the password. */
function describe(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const options = parsed.searchParams.get("options") ?? "";
  return {
    scheme: parsed.protocol.replace(":", ""),
    host: parsed.hostname,
    port: parsed.port || "5432",
    database: parsed.pathname.replace(/^\//, "") || "(none)",
    user: parsed.username || "(none)",
    hasPassword: parsed.password.length > 0,
    sslmode: parsed.searchParams.get("sslmode") ?? "(unset)",
    // Neon hands out strings carrying channel_binding=require. libpq enforces
    // it; drivers that do not implement SCRAM channel binding may instead fail
    // the handshake, which surfaces as a connection error rather than an
    // authentication one. Worth naming when a connection dies during startup.
    channelBinding: parsed.searchParams.get("channel_binding"),
    options,
    // Neon routes by SNI, but connection strings may *also* name the endpoint
    // in `options=endpoint=...`. Removing "-pooler" from the hostname and
    // leaving it in there points at an endpoint that does not exist — the
    // socket opens and the proxy then refuses it, which Prisma reports as
    // P1001 "Can't reach database server". A confusing way to learn about a
    // query parameter.
    optionsEndpoint: /endpoint[=%3D]+([\w-]+)/i.exec(options)?.[1] ?? null,
  };
}

async function main() {
  const { name, url } = pick();
  console.log(`\nChecking ${name}\n`);

  const info = describe(url);
  if (!info) {
    console.log("  ✗ Not a URL at all.");
    console.log("    It needs the whole connection string, not just the host:");
    console.log("      postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require\n");
    process.exit(1);
  }

  console.log(`  scheme    ${info.scheme}`);
  console.log(`  host      ${info.host}`);
  console.log(`  port      ${info.port}`);
  console.log(`  database  ${info.database}`);
  console.log(`  user      ${info.user}`);
  console.log(`  password  ${info.hasPassword ? "present" : "MISSING"}`);
  console.log(`  sslmode   ${info.sslmode}`);
  if (info.channelBinding) console.log(`  channel_binding  ${info.channelBinding}`);
  if (info.options) console.log(`  options   ${info.options}`);
  console.log("");

  const problems: string[] = [];
  if (!/^postgres(ql)?$/.test(info.scheme)) {
    problems.push(`Scheme is "${info.scheme}", not postgresql.`);
  }
  if (!info.hasPassword) {
    problems.push("No password in the URL.");
  }
  const migrating = name === "DIRECT_DATABASE_URL";
  if (migrating && info.host.includes("-pooler")) {
    problems.push(
      "Host is the pooled endpoint. Migrations take a session-level advisory " +
        "lock, which a pooler cannot hold — this is what P1002 means. Delete " +
        '"-pooler" from the hostname.',
    );
  }
  if (migrating && info.optionsEndpoint?.includes("-pooler")) {
    problems.push(
      `options names the endpoint "${info.optionsEndpoint}", which is still ` +
        'the pooled one. Delete "-pooler" there too, or drop the options ' +
        "parameter entirely — Neon routes by hostname without it.",
    );
  }
  if (problems.length) {
    for (const p of problems) console.log(`  ✗ ${p}\n`);
    process.exit(1);
  }

  // Everything above is shape. Now the only question that actually matters.
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 15_000 });
  try {
    await client.connect();
    const { rows } = await client.query<{ v: string }>("SELECT version() AS v");
    console.log(`  ✓ Connected — ${rows[0]?.v.split(",")[0] ?? "ok"}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ Could not connect: ${message}\n`);
    if (/password|auth|role/i.test(message)) {
      console.log("    The host is reachable, so the username or password is wrong.");
      console.log("    Copy the string from the Neon console rather than editing it by hand.");
    } else if (/endpoint|SNI|not exist/i.test(message)) {
      console.log("    Neon could not find that endpoint. Check the hostname and any");
      console.log("    options=endpoint=... parameter name the same compute.");
    } else if (info.channelBinding === "require") {
      console.log("    The string requires channel binding. Try deleting");
      console.log("    \"&channel_binding=require\" — sslmode=require still encrypts the");
      console.log("    connection, and not every driver implements the binding itself.");
    } else {
      console.log("    Neon console → Connect → untick 'Connection pooling' gives the");
      console.log("    exact string migrations need. Copy it whole.");
    }
    process.exit(1);
  }

  if (migrating) {
    // The precise thing `prisma migrate deploy` does first, and the precise
    // thing a pooler makes impossible. Reaching the database is not proof the
    // migration will run; holding this lock is.
    try {
      await client.query("SELECT pg_advisory_lock(72707369)");
      await client.query("SELECT pg_advisory_unlock(72707369)");
      console.log("  ✓ Took a session advisory lock — migrations will run here.\n");
    } catch (err) {
      console.log(`  ✗ Could not take an advisory lock: ${err instanceof Error ? err.message : err}`);
      console.log("    This connection cannot run migrations even though it works.\n");
      process.exit(1);
    }
  } else {
    console.log("");
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
