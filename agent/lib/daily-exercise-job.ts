import {
  parseRecipients,
  runDailyExercise,
  type DailyExerciseResult,
} from "./daily-exercise";
import { disconnectPrisma } from "./db";
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
  try {
    // Never honour the dev flag in production, where it would bypass the 9 o'clock check.
    const devMode =
      process.env.DAILY_EXERCISE_DEV === "1" &&
      process.env.VERCEL_ENV !== "production";
    const credentials = {
      user: requireEnv("GMAIL_USER"),
      // Google shows App Passwords in groups of four separated by spaces.
      appPassword: requireEnv("GMAIL_APP_PASSWORD").replace(/\s+/g, ""),
    };
    const recipients = parseRecipients(requireEnv("EXERCISE_RECIPIENTS"));
    requireEnv("DATABASE_URL");
    const repository = createExerciseRepository(
      devMode ? "development" : "production",
      (mail) => sendMail(credentials, mail),
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
    // A once-a-day job gains nothing from pooling, and an idle socket left open
    // could go stale while a Fluid Compute instance is suspended.
    await disconnectPrisma().catch((error) =>
      console.warn("[daily-exercise] disconnect failed", error),
    );
  }
}
