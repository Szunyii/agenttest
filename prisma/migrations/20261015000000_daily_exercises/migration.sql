-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Environment" AS ENUM ('production', 'development');

-- CreateTable
CREATE TABLE "daily_exercises" (
    "id" SERIAL NOT NULL,
    "environment" "Environment" NOT NULL,
    "slot" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "difficulty" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "exercise" TEXT NOT NULL,
    "solution" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "daily_exercises_slot_key" ON "daily_exercises"("slot");

-- CreateIndex
CREATE INDEX "daily_exercises_environment_created_at_idx" ON "daily_exercises"("environment", "created_at");

-- Supabase exposes the public schema over its REST API; with RLS on and no
-- policies, only the database owner (Prisma) can read or write the table.
ALTER TABLE "daily_exercises" ENABLE ROW LEVEL SECURITY;

-- Prisma's own bookkeeping table lives in public too. Guarded, because it does
-- not exist when the migration is replayed into a shadow database.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;
