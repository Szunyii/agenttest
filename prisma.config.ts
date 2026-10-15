import { defineConfig } from "prisma/config";

// Prisma does not load .env files itself; locally the secrets live here.
try {
  process.loadEnvFile(".env.development.local");
} catch (error) {
  // No local file, e.g. on Vercel, where the platform provides the env vars.
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
    throw error;
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // `prisma generate` runs on Vercel without DIRECT_URL; only migrations need it.
  datasource: { url: process.env.DIRECT_URL },
});
