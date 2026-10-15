import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../generated/prisma/client";

let client: PrismaClient | undefined;

// Created lazily, so a missing DATABASE_URL fails when the job runs, not when
// the module is imported, and warm serverless instances reuse one client.
export function getPrisma(): PrismaClient {
  if (!client) {
    const connectionString = process.env.DATABASE_URL?.trim();

    if (!connectionString) {
      throw new Error("Missing environment variable: DATABASE_URL");
    }

    client = new PrismaClient({
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

  return client;
}

export async function disconnectPrisma(): Promise<void> {
  const current = client;
  client = undefined;
  await current?.$disconnect();
}
