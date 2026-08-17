import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Start the development server, and the database it needs, together.
 *
 * These used to be two commands in two terminals: `prisma dev` in one, `next
 * dev` in the other. That works right up until the database terminal is closed,
 * or the machine sleeps, or a script that started it returns — and Next does
 * not notice. It keeps serving happily until a page needs the database and
 * 500s, so the failure appears minutes later, in a browser, as ECONNREFUSED,
 * with nothing on screen connecting it to the terminal that went away.
 *
 * Fifteen manual restarts in one session is the cost of that arrangement.
 *
 * Now one command owns both. The database comes up first and Next waits for it;
 * Ctrl-C stops both. Because the shutdown is clean, there is no lock left
 * behind to clear next time — the stale-lock handling below exists for crashes
 * and power cuts, not for ordinary use.
 *
 * A database that is already running is left strictly alone: not started, and
 * not stopped on exit. Whoever started it owns it.
 */

const PROJECT = "figuretracker";
const DATA_DIR = join(
  process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local"),
  "prisma-dev-nodejs",
  "Data",
  PROJECT,
);

const isWindows = process.platform === "win32";

function databasePort(): number | null {
  const url = process.env["DATABASE_URL"];
  if (!url) return null;
  try {
    const { port } = new URL(url);
    return port ? Number(port) : null;
  } catch {
    return null;
  }
}

function isListening(port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port, timeout: timeoutMs });
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.on("connect", () => done(true));
    sock.on("timeout", () => done(false));
    sock.on("error", () => done(false));
  });
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // Existence check; sends nothing.
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Remove a lock left by a server that died without tidying up.
 *
 * Guarded twice: the recorded process must be gone, and the caller must already
 * have found nothing listening. Deleting a live server's lock would corrupt the
 * database it holds open, so this errs heavily towards doing nothing.
 */
function clearStaleLock(): void {
  const serverJson = join(DATA_DIR, "server.json");
  if (!existsSync(serverJson)) return;

  let pid: unknown;
  try {
    pid = JSON.parse(readFileSync(serverJson, "utf8")).pid;
  } catch {
    return;
  }
  if (typeof pid === "number" && processAlive(pid)) return;

  const lock = join(DATA_DIR, ".lock");
  if (existsSync(lock)) {
    rmSync(lock, { recursive: true, force: true });
    console.log("  cleared a lock left behind by an unclean shutdown");
  }
}

async function waitForPort(port: number, seconds: number): Promise<boolean> {
  for (let i = 0; i < seconds * 2; i++) {
    if (await isListening(port)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** node_modules/<pkg>/<entry>, run through this same Node binary. */
function runLocal(pkg: string, entry: string, args: string[]): ChildProcess {
  return spawn(process.execPath, [join("node_modules", pkg, entry), ...args], {
    stdio: "inherit",
    env: process.env,
  });
}

/**
 * Kill a process and everything it started.
 *
 * `next dev` spawns workers, and on Windows killing only the parent orphans
 * them — they keep the port bound, so the next `npm run dev` fails with EADDRINUSE
 * for reasons that look nothing like this.
 */
function killTree(child: ChildProcess): void {
  if (!child.pid || child.killed) return;
  if (isWindows) {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

async function main() {
  const port = databasePort();
  const children: ChildProcess[] = [];
  let startedDatabase = false;

  if (port && !(await isListening(port))) {
    console.log(`\n  Starting the local database on port ${port}…`);
    clearStaleLock();

    const db = runLocal("prisma", "build/index.js", ["dev", "--name", PROJECT]);
    children.push(db);
    startedDatabase = true;

    if (!(await waitForPort(port, 40))) {
      console.error(`\n  The database did not come up on port ${port} within 40 seconds.`);
      children.forEach(killTree);
      process.exit(1);
    }
    console.log(`  Database ready on port ${port}.\n`);
  } else if (port) {
    console.log(`\n  Database already running on port ${port} — leaving it alone.\n`);
  }

  const next = runLocal("next", "dist/bin/next", ["dev"]);
  children.push(next);

  const shutdown = () => {
    // Only ours. A database that was already up belongs to whoever started it.
    for (const child of children) {
      if (child === next || startedDatabase) killTree(child);
    }
  };

  process.on("SIGINT", () => {
    shutdown();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    shutdown();
    process.exit(0);
  });

  // If Next falls over, take the database down with it rather than leaving a
  // server running that nothing is using and nobody can see.
  next.on("exit", (code) => {
    shutdown();
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
