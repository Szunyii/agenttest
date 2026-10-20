import type { PrismaClient } from "../../generated/prisma/client";

import type {
  DeliveryResult,
  Environment,
  ExerciseRecord,
  Grade,
  NewExerciseRecord,
  OutgoingMail,
  StoredScore,
} from "./daily-exercise";
import type { InboundReply } from "./replies";

// Must exceed the delivery. All emails share one SMTP connection: roughly DNS,
// connect, greeting and login (up to ~30 s if the server is slow) plus a few
// seconds per email, well under 110 s for a handful of recipients. This is an
// estimate, not a bound; the real guard is the send deadline below: no new
// email starts after it, so at most the one in flight can go out while the
// insert is rolled back. The timeout stays below Supabase's 2 min statement
// cap, so a parallel run waiting on the slot still gets P2002.
const transactionTimeoutMs = 110_000;
// Leaves room for the email in flight and the commit before the timeout.
const sendDeadlineMs = 90_000;
// The pooled connection has usually gone idle during generation, so the
// transaction opens a fresh TLS connection; Prisma's 2 s default is tight.
const transactionMaxWaitMs = 10_000;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function toDateColumn(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function fromDateColumn(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function createExerciseRepository(
  prisma: PrismaClient,
  environment: Environment,
  send: (mails: OutgoingMail[], signal: AbortSignal) => Promise<void>,
) {
  return {
    async getPrevious(): Promise<ExerciseRecord | null> {
      const row = await prisma.dailyExercise.findFirst({
        where: { environment },
        // `id` breaks ties between dev runs inserted in the same millisecond.
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });

      return row
        ? {
            id: row.id,
            date: fromDateColumn(row.date),
            createdAt: row.createdAt,
            exercise: row.exercise,
            solution: row.solution,
          }
        : null;
    },

    async getScores(exerciseId: number): Promise<Map<string, StoredScore>> {
      const rows = await prisma.submission.findMany({ where: { exerciseId } });

      return new Map(
        rows.map((row) => [
          row.email,
          {
            replyMessageId: row.replyMessageId,
            score: row.score,
            feedback: row.feedback,
          },
        ]),
      );
    },

    async saveScore(
      exerciseId: number,
      email: string,
      reply: InboundReply,
      grade: Grade,
    ): Promise<void> {
      // Stored lowercased, as getScores' callers look it up.
      const key = email.toLowerCase();
      const data = {
        replyMessageId: reply.messageId,
        receivedAt: reply.receivedAt,
        score: grade.score,
        feedback: grade.feedback,
        gradedAt: new Date(),
      };

      // A newer reply from the same recipient replaces the earlier score.
      await prisma.submission.upsert({
        where: { exerciseId_email: { exerciseId, email: key } },
        create: { exerciseId, email: key, ...data },
        update: data,
      });
    },

    async deliver(
      record: NewExerciseRecord,
      buildMails: (exerciseId: number) => OutgoingMail[],
    ): Promise<DeliveryResult> {
      try {
        // Insert and send in one transaction: if sending fails, the insert is
        // rolled back. A parallel run inserting the same slot waits for this
        // transaction and then fails with a unique violation.
        await prisma.$transaction(
          async (tx) => {
            // Started with the transaction's own timer: the insert can wait on
            // a parallel run's slot before it succeeds.
            const sendDeadline = AbortSignal.timeout(sendDeadlineMs);
            const row = await tx.dailyExercise.create({
              data: {
                environment,
                slot: record.slot,
                date: toDateColumn(record.date),
                difficulty: record.difficulty,
                topic: record.topic,
                exercise: record.exercise,
                solution: record.solution,
              },
            });
            // The emails' Message-IDs carry the new row's id.
            await send(buildMails(row.id), sendDeadline);
          },
          { timeout: transactionTimeoutMs, maxWait: transactionMaxWaitMs },
        );

        return "sent";
      } catch (error) {
        if (isUniqueViolation(error)) {
          return "already-sent";
        }

        throw error;
      }
    },
  };
}
