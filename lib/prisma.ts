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
    // DATABASE_POOL_MAX=1 for the local `prisma dev` database, which serves one
    // connection at a time: with pg's default of ten, a page that runs its
    // queries in parallel had them cut off with "Connection terminated
    // unexpectedly". Unset everywhere else, which keeps pg's default.
    adapter: new PrismaPg({
      connectionString,
      ...(Number(process.env.DATABASE_POOL_MAX) > 0 ? { max: Number(process.env.DATABASE_POOL_MAX) } : {}),
    }),
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
