import {
  parseRecipients,
  runDailyExercise,
  type DailyExerciseResult,
} from "./daily-exercise";
import { createExerciseStore } from "./exercise-store";
import { generateExercise } from "./exercise";
import { sendMail } from "./mailer";

function requireEnv(name: string): string {
  const value = process.env[name];

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
    // Dev runs use their own key so local tests never overwrite the live state.
    const store = createExerciseStore(
      devMode ? "daily-exercise:dev:last" : "daily-exercise:last",
    );

    const result = await runDailyExercise({
      now: new Date(),
      devMode,
      recipients,
      generate: () =>
        generateExercise({ difficulty: "medium", topic: "word_problem" }),
      send: (mail) => sendMail(credentials, mail),
      getLast: store.getLast,
      saveLast: store.saveLast,
    });

    console.log(`[daily-exercise] ${result}`);

    return result;
  } catch (error) {
    console.error("[daily-exercise] failed", error);
    throw error;
  }
}
