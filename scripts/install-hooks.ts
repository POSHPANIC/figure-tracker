import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * Copy this repo's git hooks into .git/hooks.
 *
 * .git/hooks is not version controlled, so the hooks live in scripts/hooks and
 * are copied into place once per clone.
 *
 * Written in TypeScript rather than shell because the shell version could only
 * be run from Git Bash — PowerShell has no `sh` on PATH, and the error it gives
 * ("The term 'sh' is not recognized") reads like the file is missing rather
 * than the interpreter. Every other script here runs through npm, so this one
 * does too.
 *
 *   npm run hooks:install
 */

const HOOKS = ["pre-push"];

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const target = join(root, ".git", "hooks");
if (!existsSync(target)) mkdirSync(target, { recursive: true });

for (const hook of HOOKS) {
  const from = join(root, "scripts", "hooks", hook);
  const to = join(target, hook);
  copyFileSync(from, to);
  // Ignored on Windows, required everywhere else.
  chmodSync(to, 0o755);
  console.log(`  installed ${hook}`);
}

console.log("");
console.log("  pre-push blocks a push when production is missing migrations");
console.log("  this code needs. It runs only when DIRECT_DATABASE_URL is in");
console.log("  .env — otherwise the only database it could check is your dev");
console.log("  one. Bypass any single push with: git push --no-verify");
console.log("");
