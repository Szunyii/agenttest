-- CreateTable
CREATE TABLE "participants" (
    "id" SERIAL NOT NULL,
    "environment" "Environment" NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "participants_environment_email_key" ON "participants"("environment", "email");

-- Rows are added by hand in Supabase, so the database refuses what the job
-- could not send to: a padded or mixed-case address, or a malformed one (the
-- same rule as normalizeRecipients). Prisma cannot express these checks and
-- leaves them alone.
ALTER TABLE "participants"
  ADD CONSTRAINT "participants_email_normalized"
    CHECK ("email" = lower(btrim("email"))),
  ADD CONSTRAINT "participants_email_format"
    CHECK ("email" ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');

-- Same as the other tables: with RLS on and no policies, only the database
-- owner (Prisma) can read or write the table through Supabase's REST API.
ALTER TABLE "participants" ENABLE ROW LEVEL SECURITY;

-- Points per participant, computed from the graded replies. security_invoker
-- applies the tables' RLS to whoever reads the view, so Supabase's REST API
-- sees nothing, while the owner (Prisma, the dashboard) sees everything.
CREATE VIEW "participant_scores" WITH (security_invoker = true) AS
SELECT
  p."environment",
  p."email",
  p."name",
  p."active",
  count(s."id") AS "submissions",
  coalesce(sum(s."score"), 0) AS "total_score",
  round(avg(s."score"), 1) AS "average_score",
  max(s."received_at") AS "last_reply_at"
FROM "participants" p
LEFT JOIN (
  "submissions" s
  JOIN "daily_exercises" e ON e."id" = s."exercise_id"
) ON e."environment" = p."environment" AND s."email" = p."email"
GROUP BY p."id";
