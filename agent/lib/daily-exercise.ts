export interface ExerciseRecord {
  date: string;
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

export interface OutgoingMail {
  bcc: string[];
  subject: string;
  text: string;
}

export type DeliveryResult = "sent" | "already-sent";

export interface DailyExerciseDeps {
  now: Date;
  devMode: boolean;
  recipients: string[];
  getPrevious: () => Promise<ExerciseRecord | null>;
  generate: () => Promise<GeneratedExercise>;
  deliver: (
    record: NewExerciseRecord,
    mail: OutgoingMail,
  ) => Promise<DeliveryResult>;
}

export type DailyExerciseResult = DeliveryResult | "skipped-hour";

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
  const recipients = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (recipients.length === 0) {
    throw new Error(
      "EXERCISE_RECIPIENTS must contain at least one email address.",
    );
  }

  return recipients;
}

export function composeEmail(
  previous: ExerciseRecord | null,
  today: GeneratedExercise,
  date: string,
): { subject: string; text: string } {
  const [year, month, day] = date.split("-");
  const sections = ["Szia!"];

  if (previous) {
    sections.push(
      [
        "Az előző feladat megoldása",
        "--------------------------",
        previous.exercise,
        "",
        `Megoldás: ${previous.solution}`,
      ].join("\n"),
    );
  }

  sections.push(["Mai feladat", "-----------", today.exercise].join("\n"));
  sections.push("A megoldást a következő levélben küldöm.");

  return {
    subject: `Napi matekfeladat – ${year}. ${month}. ${day}.`,
    text: sections.join("\n\n"),
  };
}

export async function runDailyExercise(
  deps: DailyExerciseDeps,
): Promise<DailyExerciseResult> {
  const clock = budapestClock(deps.now);

  if (!deps.devMode && clock.hour !== sendHour) {
    return "skipped-hour";
  }

  const previous = await deps.getPrevious();

  if (!deps.devMode && previous?.date === clock.date) {
    return "already-sent";
  }

  const today = await deps.generate();
  // Production allows one email per day; every dev run gets its own slot.
  const slot = deps.devMode ? deps.now.toISOString() : clock.date;

  return deps.deliver(
    { slot, date: clock.date, ...today },
    { bcc: deps.recipients, ...composeEmail(previous, today, clock.date) },
  );
}
