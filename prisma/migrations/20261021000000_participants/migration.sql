-- CreateTable
CREATE TABLE "participants" (
    "id" SERIAL NOT NULL,
    "environment" "Environment" NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "active_since" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "participants_environment_email_key" ON "participants"("environment", "email");

-- Rows are added by hand in Supabase. The view and the unique key compare
-- addresses exactly, so an address must be stored trimmed and lowercased, and
-- a malformed one would stop the daily job. The format rule is the same as
-- normalizeRecipients': JavaScript's \s is spelled out, because POSIX
-- [:space:] misses some Unicode spaces (e.g. a pasted no-break space) and
-- depends on the server's locale. Only printable ASCII without , ; : < > ( )
-- [ ] " or \ is allowed: the mailer would read anna,kovacs@gmail.com as
-- kovacs@gmail.com, and an invisible character would slip past the unique key.
-- Prisma cannot express these checks and leaves them alone.
ALTER TABLE "participants"
  ADD CONSTRAINT "participants_email_normalized"
    CHECK ("email" = lower(btrim("email"))),
  ADD CONSTRAINT "participants_email_format"
    CHECK ("email" ~ '^[^@\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+@[^@\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+\.[^@\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$'),
  ADD CONSTRAINT "participants_email_chars"
    CHECK ("email" ~ '^[!-~]+$' AND "email" !~ '[,;:<>()\[\]"\\]');

-- Same as the other tables: with RLS on and no policies, only the database
-- owner (Prisma) can read or write the table through Supabase's REST API.
ALTER TABLE "participants" ENABLE ROW LEVEL SECURITY;

-- Switching a participant back on, or moving an active one to another
-- environment or address, restarts active_since: an exercise sent before was
-- not theirs, so their next email must not say they sent no solution. Prisma
-- cannot express triggers and leaves them alone; a later migration that drops
-- or renames active_since must update this one.
CREATE FUNCTION "participants_restart_active_since"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW."active" AND (
    NOT OLD."active"
    OR NEW."environment" <> OLD."environment"
    OR NEW."email" <> OLD."email"
  ) THEN
    NEW."active_since" := CURRENT_TIMESTAMP;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "participants_restart_active_since"
BEFORE UPDATE OF "active", "environment", "email" ON "participants"
FOR EACH ROW EXECUTE FUNCTION "participants_restart_active_since"();

-- Points per participant, computed from the graded replies. security_invoker
-- applies the tables' RLS to whoever reads the view, so Supabase's REST API
-- sees nothing, while the owner (Prisma, the dashboard) sees everything.
-- The view pins the columns it uses: a later migration that changes their
-- type (e.g. the Environment enum or submissions.score) must DROP VIEW
-- "participant_scores" first and create it again afterwards.
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
