import {
  parseRecipients,
  resolveRunMode,
  runDailyExercise,
  type DailyExerciseResult,
} from "./daily-exercise";
import { createPrisma } from "./db";
import { generateExercise } from "./exercise";
import { createExerciseRepository } from "./exercise-repository";
import { gradeAnswer } from "./grader";
import { readReplies } from "./inbox";
import { sendMails } from "./mailer";
import { buildMessageId, selectReplies } from "./replies";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

export async function runDailyExerciseJob(): Promise<DailyExerciseResult> {
  let prisma: ReturnType<typeof createPrisma> | undefined;

  try {
    const { environment, devMode } = resolveRunMode(process.env);
    const credentials = {
      user: requireEnv("GMAIL_USER"),
      // Google shows App Passwords in groups of four separated by spaces.
      appPassword: requireEnv("GMAIL_APP_PASSWORD").replace(/\s+/g, ""),
    };
    const recipients = parseRecipients(requireEnv("EXERCISE_RECIPIENTS"));
    prisma = createPrisma();
    const repository = createExerciseRepository(
      prisma,
      environment,
      (mails, signal) => sendMails(credentials, mails, signal),
    );

    const result = await runDailyExercise({
      now: new Date(),
      devMode,
      recipients,
      getPrevious: repository.getPrevious,
      fetchReplies: async (previous) =>
        selectReplies(
          await readReplies(credentials, previous.createdAt, {
            environment,
            exerciseId: previous.id,
          }),
          { environment, exerciseId: previous.id, recipients },
        ),
      getScores: repository.getScores,
      grade: gradeAnswer,
      saveScore: repository.saveScore,
      generate: () =>
        generateExercise({ difficulty: "medium", topic: "word_problem" }),
      newMessageId: (exerciseId) => buildMessageId(environment, exerciseId),
      deliver: repository.deliver,
      // Only the message: AI SDK errors also carry the request body, i.e. the
      // student's reply text and images.
      warn: (message, error) =>
        console.warn(message, error instanceof Error ? error.message : error),
    });

    console.log(`[daily-exercise] ${environment}: ${result}`);

    return result;
  } catch (error) {
    console.error("[daily-exercise] failed", error);
    throw error;
  } finally {
    // Close this run's own client: a once-a-day job gains nothing from pooling,
    // and an idle socket could go stale while the instance is suspended.
    await prisma
      ?.$disconnect()
      .catch((error) =>
        console.warn("[daily-exercise] disconnect failed", error),
      );
  }
}
