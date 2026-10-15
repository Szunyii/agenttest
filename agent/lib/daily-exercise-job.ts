import {
  parseRecipients,
  resolveRunMode,
  runDailyExercise,
  type DailyExerciseResult,
} from "./daily-exercise";
import { createPrisma } from "./db";
import { generateExercise } from "./exercise";
import { createExerciseRepository } from "./exercise-repository";
import { sendMail } from "./mailer";

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
    const repository = createExerciseRepository(prisma, environment, (mail) =>
      sendMail(credentials, mail),
    );

    const result = await runDailyExercise({
      now: new Date(),
      devMode,
      recipients,
      getPrevious: repository.getPrevious,
      generate: () =>
        generateExercise({ difficulty: "medium", topic: "word_problem" }),
      deliver: repository.deliver,
    });

    console.log(`[daily-exercise] ${result}`);

    return result;
  } catch (error) {
    console.error("[daily-exercise] failed", error);
    throw error;
  } finally {
    // Close this run's own client: a once-a-day job gains nothing from pooling,
    // and an idle socket could go stale while the instance is suspended.
    await prisma?.$disconnect().catch((error) =>
      console.warn("[daily-exercise] disconnect failed", error),
    );
  }
}
