import type { InboundReply } from "./replies";

export interface ExerciseRecord {
  id: number;
  date: string;
  createdAt: Date;
  exercise: string;
  solution: string;
}

export interface GeneratedExercise {
  difficulty: string;
  topic: string;
  exercise: string;
  solution: string;
}

export interface NewExerciseRecord extends GeneratedExercise {
  slot: string;
  date: string;
}

export interface Grade {
  score: number;
  feedback: string;
}

export interface StoredScore extends Grade {
  replyMessageId: string;
}

// What a recipient's email says about their answer to the previous exercise.
export type ScoreLine =
  | ({ kind: "graded" } & Grade)
  | { kind: "none" } // no reply arrived
  | { kind: "unknown" }; // reading or grading the reply failed

export interface OutgoingMail {
  to: string;
  messageId: string;
  subject: string;
  text: string;
}

export type DeliveryResult = "sent" | "already-sent";

export interface DailyExerciseDeps {
  now: Date;
  devMode: boolean;
  recipients: string[];
  getPrevious: () => Promise<ExerciseRecord | null>;
  // The latest reply to `previous` from each recipient, keyed by the
  // lowercased address.
  fetchReplies: (
    previous: ExerciseRecord,
  ) => Promise<Map<string, InboundReply>>;
  // Stored scores of an exercise, keyed by the lowercased address.
  getScores: (exerciseId: number) => Promise<Map<string, StoredScore>>;
  grade: (previous: ExerciseRecord, reply: InboundReply) => Promise<Grade>;
  saveScore: (
    exerciseId: number,
    email: string,
    reply: InboundReply,
    grade: Grade,
  ) => Promise<void>;
  generate: () => Promise<GeneratedExercise>;
  newMessageId: (exerciseId: number) => string;
  deliver: (
    record: NewExerciseRecord,
    buildMails: (exerciseId: number) => OutgoingMail[],
  ) => Promise<DeliveryResult>;
  warn: (message: string, error: unknown) => void;
}

export type DailyExerciseResult = DeliveryResult | "skipped-hour";

export type Environment = "production" | "development";

export function resolveRunMode(env: {
  DAILY_EXERCISE_DEV?: string;
  VERCEL?: string;
  VERCEL_ENV?: string;
}): { environment: Environment; devMode: boolean } {
  if (env.VERCEL === "1" && !env.VERCEL_ENV) {
    // Without it a production cron would silently run as development.
    throw new Error(
      "VERCEL_ENV is missing on Vercel; enable 'Automatically expose System Environment Variables'.",
    );
  }

  // Only a Vercel production deployment writes production rows, so a local run
  // can never use up the real recipients' daily slot.
  const environment: Environment =
    env.VERCEL_ENV === "production" ? "production" : "development";

  return {
    environment,
    // The dev flag is never honoured in production, where it would bypass the
    // 9 o'clock check.
    devMode: environment === "development" && env.DAILY_EXERCISE_DEV === "1",
  };
}

const timeZone = "Europe/Budapest";
const sendHour = 9;

export function budapestClock(at: Date): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";

  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    hour: Number(part("hour")),
  };
}

export function parseRecipients(value: string): string[] {
  // A repeated address would get two emails and two racing grades.
  const seen = new Set<string>();
  const recipients = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => {
      const key = item.toLowerCase();

      if (!item || seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });

  if (recipients.length === 0) {
    throw new Error(
      "EXERCISE_RECIPIENTS must contain at least one email address.",
    );
  }

  // Gmail refuses a malformed address, which would roll back the delivery
  // every day; fail before anything is sent instead.
  const malformed = recipients.filter(
    (item) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item),
  );

  if (malformed.length > 0) {
    throw new Error(
      `EXERCISE_RECIPIENTS contains malformed addresses: ${malformed.join(", ")}`,
    );
  }

  return recipients;
}

function describeScore(score: ScoreLine): string {
  switch (score.kind) {
    case "graded":
      return `Pontszámod: ${score.score}/10\n${score.feedback}`;
    case "none":
      return "Erre a feladatra nem küldtél megoldást.";
    case "unknown":
      return "A pontszámot most nem sikerült megállapítani.";
  }
}

export function composeEmail(
  previous: ExerciseRecord | null,
  score: ScoreLine,
  today: Pick<GeneratedExercise, "exercise">,
  date: string,
): { subject: string; text: string } {
  const [year, month, day] = date.split("-");
  const sections = ["Szia!"];

  if (previous) {
    sections.push(
      [
        "Az előző feladat",
        "----------------",
        previous.exercise,
        "",
        `Megoldás: ${previous.solution}`,
      ].join("\n"),
    );
    sections.push(describeScore(score));
  }

  sections.push(["Mai feladat", "-----------", today.exercise].join("\n"));
  sections.push(
    "Válaszolj erre a levélre a megoldásoddal: írd bele a levélbe, vagy csatolj róla fotót. Holnap reggel megkapod a pontszámodat.",
  );

  return {
    subject: `Napi matekfeladat – ${year}. ${month}. ${day}.`,
    text: sections.join("\n\n"),
  };
}

// Designed not to reject: a recipient whose reply cannot be read or graded gets
// an "unknown" line, because today's exercise matters more than the score.
async function scorePrevious(
  deps: DailyExerciseDeps,
  previous: ExerciseRecord,
): Promise<Map<string, ScoreLine>> {
  const lines = new Map<string, ScoreLine>();
  const [fetched, loaded] = await Promise.allSettled([
    deps.fetchReplies(previous),
    deps.getScores(previous.id),
  ]);

  if (fetched.status === "rejected") {
    deps.warn("[daily-exercise] reading replies failed", fetched.reason);
  }

  if (loaded.status === "rejected") {
    // Only costs a regrade.
    deps.warn("[daily-exercise] loading scores failed", loaded.reason);
  }

  const replies = fetched.status === "fulfilled" ? fetched.value : null;
  const stored =
    loaded.status === "fulfilled"
      ? loaded.value
      : new Map<string, StoredScore>();

  await Promise.all(
    deps.recipients.map(async (recipient) => {
      const email = recipient.toLowerCase();
      const reply = replies?.get(email);
      const known = stored.get(email);

      // A rerun keeps an earlier run's score unless a different reply is now
      // the latest, even if the reply has left the inbox or the inbox is
      // unreadable.
      if (known && (!reply || known.replyMessageId === reply.messageId)) {
        lines.set(recipient, {
          kind: "graded",
          score: known.score,
          feedback: known.feedback,
        });
        return;
      }

      if (!reply) {
        // Without the inbox we cannot tell whether a reply arrived.
        lines.set(recipient, { kind: replies ? "none" : "unknown" });
        return;
      }

      let grade: Grade;

      try {
        grade = await deps.grade(previous, reply);
      } catch (error) {
        deps.warn(`[daily-exercise] grading ${email} failed`, error);
        lines.set(recipient, { kind: "unknown" });
        return;
      }

      lines.set(recipient, { kind: "graded", ...grade });

      try {
        await deps.saveScore(previous.id, email, reply, grade);
      } catch (error) {
        deps.warn(
          `[daily-exercise] saving the score of ${email} failed`,
          error,
        );
      }
    }),
  );

  return lines;
}

export async function runDailyExercise(
  deps: DailyExerciseDeps,
): Promise<DailyExerciseResult> {
  const clock = budapestClock(deps.now);

  if (!deps.devMode && clock.hour !== sendHour) {
    return "skipped-hour";
  }

  const previous = await deps.getPrevious();

  // Only saves the IMAP read and the Claude calls: `deliver` is authoritative
  // via the unique slot, which equals the date in production.
  if (!deps.devMode && previous?.date === clock.date) {
    return "already-sent";
  }

  // Scoring and generating are independent, so they share one time window.
  // Waiting for both keeps a failed generation from leaving grading running.
  const [scoring, generation] = await Promise.allSettled([
    previous
      ? scorePrevious(deps, previous)
      : Promise.resolve(new Map<string, ScoreLine>()),
    // Deferred, so even a synchronous throw waits for scoring to settle.
    Promise.resolve().then(() => deps.generate()),
  ]);

  if (scoring.status === "rejected") {
    deps.warn("[daily-exercise] scoring failed", scoring.reason);
  }

  if (generation.status === "rejected") {
    throw generation.reason;
  }

  const today = generation.value;
  const scores =
    scoring.status === "fulfilled"
      ? scoring.value
      : new Map<string, ScoreLine>();
  // Production allows one email per day; every dev run gets its own slot.
  const slot = deps.devMode ? deps.now.toISOString() : clock.date;

  return deps.deliver({ ...today, slot, date: clock.date }, (exerciseId) =>
    deps.recipients.map((recipient) => ({
      to: recipient,
      messageId: deps.newMessageId(exerciseId),
      ...composeEmail(
        previous,
        scores.get(recipient) ?? { kind: "unknown" },
        today,
        clock.date,
      ),
    })),
  );
}
