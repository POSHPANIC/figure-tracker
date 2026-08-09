import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

/**
 * A single shared PrismaClient.
 *
 * Next.js hot-reloads modules in development, which would otherwise create a
 * new client (and a new connection pool) on every file save until Postgres
 * refuses new connections. Stashing the instance on `globalThis` survives
 * reloads. In production the module is only evaluated once, so this is a no-op.
 */

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env, then run `npx prisma dev --name figuretracker`.",
  );
}

function createClient() {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createClient>;
};

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
