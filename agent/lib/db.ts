import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../generated/prisma/client";

// One client per job run: with a shared client, one run's cleanup
// (`$disconnect()` cancels open transactions) could roll back another run's
// insert when Fluid Compute runs them concurrently on the same instance. The
// client connects lazily, so a run that skips never opens a connection.
export function createPrisma(): PrismaClient {
  const connectionString = process.env.DATABASE_URL?.trim();

  if (!connectionString) {
    throw new Error("Missing environment variable: DATABASE_URL");
  }

  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      // Supabase's pooler strings carry no sslmode, so force TLS. The
      // pooler's CA is not in Node's trust store, so it is not verified.
      ssl: { rejectUnauthorized: false },
      // Without it, pg waits for the OS TCP timeout if the pooler is unreachable.
      connectionTimeoutMillis: 10_000,
    }),
  });
}
