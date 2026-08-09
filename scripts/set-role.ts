/**
 * Grant or revoke a user's role. There's deliberately no UI for this — the
 * first admin has to be made from a machine with database access.
 *
 *   npm run set-role -- you@example.com ADMIN
 *   npm run set-role -- helper@example.com MODERATOR
 *   npm run set-role -- someone@example.com USER
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";

const ROLES = ["USER", "MODERATOR", "ADMIN"] as const;
type Role = (typeof ROLES)[number];

async function main() {
  const [email, role] = process.argv.slice(2);

  if (!email || !role) {
    console.error("Usage: npm run set-role -- <email> <USER|MODERATOR|ADMIN>");
    process.exit(1);
  }
  if (!ROLES.includes(role as Role)) {
    console.error(`Role must be one of: ${ROLES.join(", ")}`);
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, email: true, role: true },
  });

  if (!user) {
    console.error(`No user with email ${email}. They need to sign in once first.`);
    process.exit(1);
  }

  await prisma.user.update({ where: { id: user.id }, data: { role: role as Role } });
  console.log(`${user.email}: ${user.role} -> ${role}`);
  console.log("They'll need to sign out and back in for the change to take effect.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
