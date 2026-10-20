-- CreateTable
CREATE TABLE "submissions" (
    "id" SERIAL NOT NULL,
    "exercise_id" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "reply_message_id" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "score" INTEGER NOT NULL,
    "feedback" TEXT NOT NULL,
    "graded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "submissions_exercise_id_email_key" ON "submissions"("exercise_id", "email");

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "daily_exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same as daily_exercises: with RLS on and no policies, only the database
-- owner (Prisma) can read or write the table through Supabase's REST API.
ALTER TABLE "submissions" ENABLE ROW LEVEL SECURITY;
