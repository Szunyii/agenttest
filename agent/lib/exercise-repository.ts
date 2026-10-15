import type {
  DeliveryResult,
  ExerciseRecord,
  NewExerciseRecord,
  OutgoingMail,
} from "./daily-exercise";
import { getPrisma } from "./db";

export type Environment = "production" | "development";

// Must exceed the slowest send: DNS 10 s + connect 10 s per resolved address +
// greeting 10 s + a 30 s socket stall ≈ 70 s. If it fired mid-send, the mail
// could go out while the insert is rolled back. It stays below Supabase's 2 min
// statement cap, so a parallel run waiting on the slot still gets P2002.
const transactionTimeoutMs = 90_000;
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
  environment: Environment,
  send: (mail: OutgoingMail) => Promise<void>,
) {
  return {
    async getPrevious(): Promise<ExerciseRecord | null> {
      const row = await getPrisma().dailyExercise.findFirst({
        where: { environment },
        // `id` breaks ties between dev runs inserted in the same millisecond.
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });

      return row
        ? {
            date: fromDateColumn(row.date),
            exercise: row.exercise,
            solution: row.solution,
          }
        : null;
    },

    async deliver(
      record: NewExerciseRecord,
      mail: OutgoingMail,
    ): Promise<DeliveryResult> {
      try {
        // Insert and send in one transaction: if sending fails, the insert is
        // rolled back. A parallel run inserting the same slot waits for this
        // transaction and then fails with a unique violation.
        await getPrisma().$transaction(
          async (tx) => {
            await tx.dailyExercise.create({
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
            await send(mail);
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
