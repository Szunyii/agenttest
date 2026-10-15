# Napi matekfeladat e-mailben – megvalósítási terv

> **2026-10-15:** a tárolás Upstash Redisről Supabase + Prismára változott („minden vagy semmi” tranzakció). Lásd `docs/superpowers/specs/2026-10-15-supabase-prisma-store-design.md` és `docs/superpowers/plans/2026-10-15-supabase-prisma-store.md`. Az Upstash-ra és a `KV_*` változókra vonatkozó részek elavultak; a helyi próba és az élesítés lépései az új terv 6–8. taskjában vannak.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Az agent minden nap 9:00-kor (Europe/Budapest) e-mailben kiküld egy Claude által írt, közepes nehézségű szöveges matekfeladatot három címzettnek, a levél elején az előző feladat megoldásával.

**Architecture:** Két eve schedule (07:00 és 08:00 UTC) ugyanazt a jobot hívja. A job csak akkor küld, ha Budapesten 9 óra van. A napi logika tiszta, függőség-injektált modul (`daily-exercise.ts`), a valódi szolgáltatásokat (Claude, Gmail SMTP, Upstash Redis) a `daily-exercise-job.ts` köti be. A chatben használt `get_exercise` tool és a napi job ugyanazt a `generateExercise` függvényt használja.

**Tech Stack:** eve 0.75, AI SDK 7 (`generateText` + `Output.object`), `eve/models/anthropic` (`claude-sonnet-5-5`), nodemailer 10.0.13 (Gmail SMTP, App Password), @upstash/redis 1.39.0, Node 24 beépített tesztfuttató (`node --test`, natív TypeScript type stripping), zod 4.

Spec: `docs/superpowers/specs/2026-10-14-daily-math-email-design.md`

**Commitok:** a repóban a felhasználónak sok commitolatlan munkája van. A végrehajtás elején kérdezd meg egyszer, hogy commitolhatsz-e. Ha nem, hagyd ki a „Commit” lépéseket. Ha igen, mindig csak az adott task fájljait add hozzá (`git add <fájlok>`), soha ne `git add -A`-t.

**Állapot (2026-10-14):** az 1–8. task kész a `feature/daily-math-email` ágon. A taskonkénti review-k nyomán a kód több ponton eltér a lenti kódblokkoktól; ezekben a repó kódja a mérvadó:

- **Task 2:** 4 további teszt (összesen 18): az előző megoldás megléte, órahatárok (téli 08:30, 09:59, nyári 10:00), generálási hiba.
- **Task 3:** szigorúbb prompt: sima szöveg, „Megoldás:” címke nélküli megoldás, egyértelmű csigás példa, véletlen történet-helyszín, témafüggetlen nehézségi utalások.
- **Task 6:** SMTP-időkorlátok, figyelmeztetés elutasított címzettnél, `||` és `.trim()` a Redis-változóknál.
- **Task 7:** a schedule-ök `async run() { await runDailyExerciseJob(); }` alakúak, így a hiba a Vercelen is hibás futásként látszik; a `DAILY_EXERCISE_DEV` éles környezetben (`VERCEL_ENV=production`) hatástalan.
- **Task 8:** az eval-fájl kész, de Anthropic-kulcs nélkül nem futtatható; a futtatás a Task 9 része.

---

## Fájlszerkezet

| Fájl | Művelet | Felelősség |
|---|---|---|
| `tsconfig.json` | módosít | `allowImportingTsExtensions`, `tests/` a typecheckben |
| `package.json` | módosít | `test` script, új függőségek |
| `tests/daily-exercise.test.ts` | új | A napi logika unit tesztjei |
| `agent/lib/daily-exercise.ts` | új | Tiszta logika: budapesti óra/dátum, címlista-feldolgozás, levél összeállítása, napi folyamat. Futásidőben semmit nem importál, ezért Node-dal közvetlenül tesztelhető. |
| `agent/lib/exercise.ts` | új | `generateExercise()` Claude-dal; `word_problem` téma |
| `agent/tools/get_exercise.ts` | módosít | Vékony réteg a `generateExercise` fölött |
| `agent/agent.ts` | módosít | Modell: `anthropic("claude-sonnet-5-5")` |
| `agent/lib/mailer.ts` | új | `sendMail()` Gmail SMTP-n |
| `agent/lib/exercise-store.ts` | új | `createExerciseStore(key)` → `getLast` / `saveLast` Upstash Redisben |
| `agent/lib/daily-exercise-job.ts` | új | Környezeti változók beolvasása, a valódi függőségek bekötése, `runDailyExerciseJob()` |
| `agent/schedules/daily-exercise-summer.ts` | új | `0 7 * * *` → job |
| `agent/schedules/daily-exercise-winter.ts` | új | `0 8 * * *` → job |
| `evals/get-exercise.eval.ts` | új | A chat meghívja-e a `get_exercise`-t |

Eltérések a spectől: a spec `daily-exercise.ts`-e két fájlra bomlik (`daily-exercise.ts` + `daily-exercise-job.ts`), hogy a logika futásidejű importok nélkül tesztelhető legyen. `@types/nodemailer` nem kell, a nodemailer 10 saját típusokat hoz.

---

### Task 1: Tesztfuttató beállítása

**Files:**
- Modify: `tsconfig.json`
- Modify: `package.json` (`scripts`)

A Node 24 natívan futtat `.ts` fájlokat, de relatív importnál kötelező a `.ts` kiterjesztés. Ezt a TypeScript csak `allowImportingTsExtensions` mellett engedi (ehhez `noEmit: true` kell, ami már be van állítva). Az eve fordítóját ez nem érinti.

- [ ] **Step 1: tsconfig módosítása**

A `tsconfig.json` teljes új tartalma:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "types": ["node", "eve/workflow-modules"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "allowImportingTsExtensions": true
  },
  "include": ["agent/**/*.ts", "evals/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 2: `test` script hozzáadása**

A `package.json` `scripts` objektumába, a `"typecheck": "tsc",` sor után:

```json
    "test": "node --test \"tests/**/*.test.ts\"",
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit; echo "exit: $?"`
Expected: `exit: 0`

- [ ] **Step 4: Commit** (csak ha a felhasználó engedte)

```bash
git add tsconfig.json package.json
git commit -m "chore: run TypeScript unit tests with node --test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: A napi logika (TDD)

**Files:**
- Create: `tests/daily-exercise.test.ts`
- Create: `agent/lib/daily-exercise.ts`

- [ ] **Step 1: A teszt megírása**

`tests/daily-exercise.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  budapestClock,
  composeEmail,
  parseRecipients,
  runDailyExercise,
  type DailyExerciseDeps,
  type ExerciseRecord,
  type OutgoingMail,
} from "../agent/lib/daily-exercise.ts";

const today = { exercise: "Mai feladat szövege", solution: "Mai megoldás" };
const previous: ExerciseRecord = {
  date: "2026-10-14",
  exercise: "Előző feladat szövege",
  solution: "Előző megoldás",
};

function fakeDeps(overrides: Partial<DailyExerciseDeps> = {}) {
  const calls: string[] = [];
  const sent: OutgoingMail[] = [];
  const saved: ExerciseRecord[] = [];
  const deps: DailyExerciseDeps = {
    now: new Date("2026-10-15T07:05:00Z"), // 09:05 in Budapest (CEST)
    devMode: false,
    recipients: ["a@example.com", "b@example.com"],
    generate: async () => {
      calls.push("generate");
      return today;
    },
    send: async (mail) => {
      calls.push("send");
      sent.push(mail);
    },
    getLast: async () => previous,
    saveLast: async (record) => {
      calls.push("save");
      saved.push(record);
    },
    ...overrides,
  };

  return { deps, calls, sent, saved };
}

describe("budapestClock", () => {
  it("uses summer time (UTC+2) in July", () => {
    assert.deepEqual(budapestClock(new Date("2026-07-01T07:30:00Z")), {
      date: "2026-07-01",
      hour: 9,
    });
  });

  it("uses winter time (UTC+1) in December", () => {
    assert.deepEqual(budapestClock(new Date("2026-12-01T08:15:00Z")), {
      date: "2026-12-01",
      hour: 9,
    });
  });

  it("switches to winter time on the last Sunday of October", () => {
    assert.equal(budapestClock(new Date("2026-10-25T07:00:00Z")).hour, 8);
    assert.equal(budapestClock(new Date("2026-10-25T08:00:00Z")).hour, 9);
  });

  it("returns the Budapest date, not the UTC date", () => {
    assert.deepEqual(budapestClock(new Date("2026-12-31T23:30:00Z")), {
      date: "2027-01-01",
      hour: 0,
    });
  });
});

describe("parseRecipients", () => {
  it("splits, trims and drops empty entries", () => {
    assert.deepEqual(
      parseRecipients(" a@example.com, b@example.com ,,c@example.com "),
      ["a@example.com", "b@example.com", "c@example.com"],
    );
  });

  it("throws when no address is given", () => {
    assert.throws(() => parseRecipients(" , "), /EXERCISE_RECIPIENTS/);
  });
});

describe("composeEmail", () => {
  it("puts the previous solution before today's exercise", () => {
    const mail = composeEmail(previous, today, "2026-10-15");

    assert.equal(mail.subject, "Napi matekfeladat – 2026. 10. 15.");
    assert.ok(mail.text.includes("Előző feladat szövege"));
    assert.ok(
      mail.text.indexOf("Előző megoldás") <
        mail.text.indexOf("Mai feladat szövege"),
    );
  });

  it("never reveals today's solution", () => {
    const mail = composeEmail(previous, today, "2026-10-15");

    assert.ok(!mail.text.includes("Mai megoldás"));
  });

  it("leaves out the previous block on the first day", () => {
    const mail = composeEmail(null, today, "2026-10-15");

    assert.ok(!mail.text.includes("Az előző feladat megoldása"));
    assert.ok(mail.text.includes("Mai feladat szövege"));
  });
});

describe("runDailyExercise", () => {
  it("sends at 9 in Budapest and saves only afterwards", async () => {
    const { deps, calls, sent, saved } = fakeDeps();

    assert.equal(await runDailyExercise(deps), "sent");
    assert.deepEqual(calls, ["generate", "send", "save"]);
    assert.deepEqual(sent[0].bcc, ["a@example.com", "b@example.com"]);
    assert.deepEqual(saved, [{ date: "2026-10-15", ...today }]);
  });

  it("skips when it is not 9 in Budapest", async () => {
    const { deps, calls } = fakeDeps({
      now: new Date("2026-10-15T08:05:00Z"), // 10:05 in Budapest
    });

    assert.equal(await runDailyExercise(deps), "skipped-hour");
    assert.deepEqual(calls, []);
  });

  it("skips when today's email has already been sent", async () => {
    const { deps, calls } = fakeDeps({
      getLast: async () => ({ ...previous, date: "2026-10-15" }),
    });

    assert.equal(await runDailyExercise(deps), "already-sent");
    assert.deepEqual(calls, []);
  });

  it("does not save when sending fails", async () => {
    const { deps, saved } = fakeDeps({
      send: async () => {
        throw new Error("SMTP down");
      },
    });

    await assert.rejects(runDailyExercise(deps), /SMTP down/);
    assert.deepEqual(saved, []);
  });

  it("ignores the hour and the already-sent check in dev mode", async () => {
    const { deps } = fakeDeps({
      devMode: true,
      now: new Date("2026-10-15T12:00:00Z"),
      getLast: async () => ({ ...previous, date: "2026-10-15" }),
    });

    assert.equal(await runDailyExercise(deps), "sent");
  });
});
```

- [ ] **Step 2: A teszt bukásának ellenőrzése**

Run: `npm test`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` hibával az `agent/lib/daily-exercise.ts`-re.

- [ ] **Step 3: Implementáció**

`agent/lib/daily-exercise.ts`:

```ts
export interface ExerciseRecord {
  date: string;
  exercise: string;
  solution: string;
}

export interface GeneratedExercise {
  exercise: string;
  solution: string;
}

export interface OutgoingMail {
  bcc: string[];
  subject: string;
  text: string;
}

export interface DailyExerciseDeps {
  now: Date;
  devMode: boolean;
  recipients: string[];
  generate: () => Promise<GeneratedExercise>;
  send: (mail: OutgoingMail) => Promise<void>;
  getLast: () => Promise<ExerciseRecord | null>;
  saveLast: (record: ExerciseRecord) => Promise<void>;
}

export type DailyExerciseResult = "sent" | "skipped-hour" | "already-sent";

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

  const previous = await deps.getLast();

  if (!deps.devMode && previous?.date === clock.date) {
    return "already-sent";
  }

  const today = await deps.generate();

  await deps.send({
    bcc: deps.recipients,
    ...composeEmail(previous, today, clock.date),
  });
  // Save only after a successful send, so a failed day never hides a solution.
  await deps.saveLast({
    date: clock.date,
    exercise: today.exercise,
    solution: today.solution,
  });

  return "sent";
}
```

- [ ] **Step 4: Tesztek futtatása**

Run: `npm test`
Expected: PASS, `# pass 14`, `# fail 0`.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit; echo "exit: $?"`
Expected: `exit: 0`

- [ ] **Step 6: Commit** (csak ha a felhasználó engedte)

```bash
git add tests/daily-exercise.test.ts agent/lib/daily-exercise.ts
git commit -m "feat: add daily exercise scheduling and email logic

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Feladatgenerálás kiemelése, Claude, szöveges feladat

**Files:**
- Create: `agent/lib/exercise.ts`
- Modify: `agent/tools/get_exercise.ts` (teljes csere)

- [ ] **Step 1: `agent/lib/exercise.ts` létrehozása**

```ts
import { generateText, Output } from "ai";
import { anthropic } from "eve/models/anthropic";

import z from "zod";

export const difficulties = ["easy", "medium", "hard"] as const;
export const topics = [
  "arithmetic",
  "algebra",
  "geometry",
  "word_problem",
] as const;

export type Difficulty = (typeof difficulties)[number];
export type Topic = (typeof topics)[number];

const model = "claude-sonnet-5-5";

const difficultyHints: Record<Difficulty, string> = {
  easy: "one or two simple steps with small whole numbers",
  medium: "two or three steps, for example percentages or a short word problem",
  hard: "several steps or a well-known formula, for example Pythagoras or a quadratic equation",
};

const topicHints: Record<Topic, string> = {
  arithmetic: "arithmetic, fractions or percentages",
  algebra: "equations or expressions",
  geometry: "plane geometry: perimeter, area, angles or Pythagoras",
  word_problem: [
    "a short everyday story (szöveges feladat) that the student has to turn into math.",
    "Match the style of this example, but do not reuse its story:",
    "Egy csiga minden nap 4 métert halad felfelé egy fán, éjszaka visszacsúszik 3 métert. Milyen magas a fa, ha a kilencedik napon éri el a tetejét?",
    "Megoldás: 8 nap alatt 8 métert jut feljebb, a 9. napon még 4 métert mászik, tehát a fa 12 méter magas.",
  ].join("\n"),
};

export const exerciseSchema = z.object({
  difficulty: z.enum(difficulties),
  topic: z.enum(topics),
  exercise: z.string().describe("The exercise text to show to the user."),
  solution: z
    .string()
    .describe("The worked solution. Keep it hidden until the user asks."),
});

export type Exercise = z.infer<typeof exerciseSchema>;

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export async function generateExercise(input: {
  difficulty?: Difficulty;
  topic?: Topic;
}): Promise<Exercise> {
  // Models are poor at randomness, so pick the missing parameters in code.
  const difficulty = input.difficulty ?? pick(difficulties);
  const topic = input.topic ?? pick(topics);
  const seedNumbers = Array.from(
    { length: 3 },
    () => 2 + Math.floor(Math.random() * 40),
  );

  const { output } = await generateText({
    model: anthropic(model),
    output: Output.object({
      schema: exerciseSchema.pick({ exercise: true, solution: true }),
    }),
    system:
      "You write math exercises for students. Write the exercise and its worked solution in Hungarian. The exercise must be self-contained, have exactly one correct final answer, and match the requested topic and difficulty. Work the solution out step by step and double-check it before answering.",
    prompt: [
      `Topic: ${topicHints[topic]}`,
      `Difficulty: ${difficulty} (${difficultyHints[difficulty]})`,
      `Use these numbers as inspiration so the exercise differs every time: ${seedNumbers.join(", ")}. Change them if needed to get a clean result.`,
    ].join("\n"),
  });

  return { difficulty, topic, ...output };
}
```

- [ ] **Step 2: `agent/tools/get_exercise.ts` cseréje**

A fájl teljes új tartalma:

```ts
import { defineTool } from "eve/tools";
import { never } from "eve/tools/approval";

import z from "zod";

import {
  difficulties,
  exerciseSchema,
  generateExercise,
  topics,
} from "../lib/exercise";

export default defineTool({
  approval: never(),
  description:
    "Get a math exercise together with its solution. Use this whenever the user asks for a math exercise, example, word problem or practice problem (for example 'adj egy matek példát'); do not make one up yourself. Show only the exercise and keep the solution hidden until the user replies with an answer or asks for the solution, then check their answer or reveal the solution. The exercise is written in Hungarian; translate it if the user writes in another language. Difficulty and topic are optional: leave them out for a random exercise, and use the word_problem topic for a story-style exercise (szöveges feladat).",
  inputSchema: z.object({
    difficulty: z
      .enum(difficulties)
      .optional()
      .describe("How hard the exercise should be, if the user asked for it."),
    topic: z
      .enum(topics)
      .optional()
      .describe("The area of the exercise, if the user asked for it."),
  }),
  outputSchema: exerciseSchema,
  async execute(input) {
    return generateExercise(input);
  },
});
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit; echo "exit: $?"`
Expected: `exit: 0`

- [ ] **Step 4: Commit** (csak ha a felhasználó engedte)

```bash
git add agent/lib/exercise.ts agent/tools/get_exercise.ts
git commit -m "feat: generate exercises with Claude and add word problems

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Az agent modelljének cseréje Claude-ra

**Files:**
- Modify: `agent/agent.ts` (teljes csere)

- [ ] **Step 1: `agent/agent.ts` cseréje**

```ts
import { anthropic } from "eve/models/anthropic";
import { defineAgent } from "eve";

export default defineAgent({
  model: anthropic("claude-sonnet-5-5"),
  reasoning: "high",
});
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit; echo "exit: $?"`
Expected: `exit: 0`

- [ ] **Step 3: Commit** (csak ha a felhasználó engedte)

```bash
git add agent/agent.ts
git commit -m "feat: switch the agent model to Claude Sonnet 5.5

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Új függőségek

**Files:**
- Modify: `package.json`, `package-lock.json`

A verziók pontosan rögzítve, mindkettő legalább két hete jelent meg (nodemailer 10.0.13: 2026-09-30, @upstash/redis 1.39.0: 2026-09-21).

- [ ] **Step 1: Telepítés**

Run: `npm install --save-exact nodemailer@10.0.13 @upstash/redis@1.39.0`
Expected: kilépési kód 0. A `package.json` `dependencies` között megjelenik a `"nodemailer": "10.0.13"` és az `"@upstash/redis": "1.39.0"`.

- [ ] **Step 2: Ellenőrzés**

Run: `npm ls nodemailer @upstash/redis`
Expected: `nodemailer@10.0.13` és `@upstash/redis@1.39.0`, `UNMET` vagy `invalid` nélkül.

- [ ] **Step 3: Commit** (csak ha a felhasználó engedte)

```bash
git add package.json package-lock.json
git commit -m "chore: add nodemailer and @upstash/redis

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Levélküldés és tároló

**Files:**
- Create: `agent/lib/mailer.ts`
- Create: `agent/lib/exercise-store.ts`

Ez a két fájl csak vékony réteg külső szolgáltatások fölött, saját logikájuk nincs. A Task 9 kézi végpontig tartó futtatása ellenőrzi őket.

- [ ] **Step 1: `agent/lib/mailer.ts`**

```ts
import { createTransport } from "nodemailer";

import type { OutgoingMail } from "./daily-exercise";

export interface MailCredentials {
  user: string;
  appPassword: string;
}

export async function sendMail(
  credentials: MailCredentials,
  mail: OutgoingMail,
): Promise<void> {
  const transport = createTransport({
    service: "gmail",
    auth: { user: credentials.user, pass: credentials.appPassword },
  });

  // Recipients go in BCC so they do not see each other's addresses.
  await transport.sendMail({
    from: credentials.user,
    to: credentials.user,
    bcc: mail.bcc,
    subject: mail.subject,
    text: mail.text,
  });
}
```

- [ ] **Step 2: `agent/lib/exercise-store.ts`**

A Vercel Marketplace Upstash-integrációja `KV_REST_API_*` vagy `UPSTASH_REDIS_REST_*` nevű változókat állít be, ezért mindkettőt olvassa.

```ts
import { Redis } from "@upstash/redis";

import type { ExerciseRecord } from "./daily-exercise";

function getRedis(): Redis {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error(
      "Missing Redis credentials: set KV_REST_API_URL and KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN).",
    );
  }

  return new Redis({ url, token });
}

export function createExerciseStore(key: string) {
  return {
    async getLast(): Promise<ExerciseRecord | null> {
      return (await getRedis().get<ExerciseRecord>(key)) ?? null;
    },
    async saveLast(record: ExerciseRecord): Promise<void> {
      await getRedis().set(key, record);
    },
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit; echo "exit: $?"`
Expected: `exit: 0`

- [ ] **Step 4: Commit** (csak ha a felhasználó engedte)

```bash
git add agent/lib/mailer.ts agent/lib/exercise-store.ts
git commit -m "feat: send mail through Gmail SMTP and store the last exercise in Redis

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: A job és a két schedule

**Files:**
- Create: `agent/lib/daily-exercise-job.ts`
- Create: `agent/schedules/daily-exercise-summer.ts`
- Create: `agent/schedules/daily-exercise-winter.ts`

- [ ] **Step 1: `agent/lib/daily-exercise-job.ts`**

```ts
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
    const devMode = process.env.DAILY_EXERCISE_DEV === "1";
    const credentials = {
      user: requireEnv("GMAIL_USER"),
      appPassword: requireEnv("GMAIL_APP_PASSWORD"),
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
```

- [ ] **Step 2: `agent/schedules/daily-exercise-summer.ts`**

```ts
import { defineSchedule } from "eve/schedules";

import { runDailyExerciseJob } from "../lib/daily-exercise-job";

// 07:00 UTC is 09:00 in Budapest during summer time (CEST). The job itself
// sends only when it is 9 in Budapest, so this run is skipped in winter.
export default defineSchedule({
  cron: "0 7 * * *",
  run({ waitUntil }) {
    waitUntil(runDailyExerciseJob());
  },
});
```

- [ ] **Step 3: `agent/schedules/daily-exercise-winter.ts`**

```ts
import { defineSchedule } from "eve/schedules";

import { runDailyExerciseJob } from "../lib/daily-exercise-job";

// 08:00 UTC is 09:00 in Budapest during winter time (CET). The job itself
// sends only when it is 9 in Budapest, so this run is skipped in summer.
export default defineSchedule({
  cron: "0 8 * * *",
  run({ waitUntil }) {
    waitUntil(runDailyExerciseJob());
  },
});
```

- [ ] **Step 4: Typecheck és tesztek**

Run: `npx tsc --noEmit; echo "exit: $?"; npm test`
Expected: `exit: 0`, és a tesztek továbbra is PASS (`# fail 0`).

- [ ] **Step 5: Commit** (csak ha a felhasználó engedte)

```bash
git add agent/lib/daily-exercise-job.ts agent/schedules/daily-exercise-summer.ts agent/schedules/daily-exercise-winter.ts
git commit -m "feat: schedule the daily math exercise email

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Eval a `get_exercise` toolra

**Files:**
- Create: `evals/get-exercise.eval.ts`
- Modify (csak ha az eval elbukik): `agent/instructions.md`

Előfeltétel: az Anthropic hitelesítés helyben (lásd Task 9, 1. lépés). Nélküle az agent nem tud válaszolni.

- [ ] **Step 1: Az eval megírása**

```ts
import { defineEval } from "eve/evals";

export default defineEval({
  description: "A request for a math example must use the get_exercise tool.",

  async test(t) {
    await t.send("adj egy matek példát");
    t.succeeded();
    t.calledTool("get_exercise");
  },
});
```

- [ ] **Step 2: Futtatás**

Run: `npx eve eval get-exercise`
Expected: kilépési kód 0, `calledTool(get_exercise)` passed.

- [ ] **Step 3: Csak ha a 2. lépés elbukott**

Az `agent/instructions.md` `# Tools` szakaszába, a weather-sor alá:

```md
When the user asks for a math exercise, example or word problem, always call the `get_exercise` tool and show only the exercise from its result. Do not write an exercise yourself.
```

Utána futtasd újra: `npx eve eval get-exercise`. Expected: kilépési kód 0.

- [ ] **Step 4: Commit** (csak ha a felhasználó engedte)

```bash
git add evals/get-exercise.eval.ts agent/instructions.md
git commit -m "test: eval that math requests call get_exercise

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Kézi végpontig tartó próba helyben (a felhasználóval)

Ehhez a felhasználó titkos adatai kellenek. Ezeket a végrehajtó nem találja ki, és nem kéri be a chatben: a felhasználó maga írja be a `.env.development.local` fájlba. Ezt az `eve dev` és az `eve eval` a legmagasabb prioritással olvassa, és a Vercel CLI nem írja felül (a `.env.local`-t viszont az `eve link` és az `eve deploy` felülírja a `vercel env pull` miatt). A `.env*` a `.gitignore` szerint nem kerül gitbe.

- [ ] **Step 1: A felhasználó előkészít**

1. Google-fiók: kétlépcsős azonosítás bekapcsolása, majd App Password létrehozása (Google-fiók → Biztonság → Alkalmazásjelszavak).
2. Anthropic API-kulcs.
3. Upstash Redis adatbázis (a Vercel Marketplace-ről vagy az upstash.com-ról), a REST URL és a token.

- [ ] **Step 2: A felhasználó kitölti a `.env.development.local`-t a projekt gyökerében**

```
ANTHROPIC_API_KEY=<Anthropic API-kulcs>
GMAIL_USER=<küldő Gmail-cím>
GMAIL_APP_PASSWORD=<App Password, szóközök nélkül>
EXERCISE_RECIPIENTS=<a felhasználó SAJÁT címe, nem a három címzett>
DAILY_EXERCISE_DEV=1
KV_REST_API_URL=<Upstash REST URL>
KV_REST_API_TOKEN=<Upstash REST token>
```

- [ ] **Step 3: Dev szerver indítása**

Run (külön terminálban, a felhasználó indítja): `npm run dev`
Expected: a dev szerver fut a `http://localhost:2000` címen. A környezeti változókat csak a schedule futása ellenőrzi, ezért induláskor nem jelez hiányt.

- [ ] **Step 4: A schedule kézi indítása**

Run: `curl -si -X POST http://localhost:2000/eve/v1/dev/schedules/daily-exercise-summer`
Expected: `HTTP/1.1 200` és `{"scheduleId":"daily-exercise-summer","sessionIds":[]}` (a job nem indít agent-sessiont, ezért üres a lista). A dev szerver logjában `[daily-exercise] sent`. A felhasználó postafiókjába megérkezik a `Napi matekfeladat – <mai dátum>` levél, előző-blokk nélkül. Hiba esetén a válasz HTTP 500, és a logban `[daily-exercise] failed` áll a hibaüzenettel.

- [ ] **Step 5: Második futtatás**

Run: `curl -si -X POST http://localhost:2000/eve/v1/dev/schedules/daily-exercise-summer`
Expected: HTTP 200, és egy második levél, amely „Az előző feladat megoldása” blokkal kezdődik, abban az első levél feladatával és megoldásával. A megoldás előtt csak egyszer szerepel a „Megoldás:” címke, és a szövegben nincs Markdown vagy LaTeX.

- [ ] **Step 6: Chat-próba**

A dev chatben: „adj egy szöveges matek feladatot”. Expected: a válasz egy szöveges feladat, megoldás nélkül, és a trace-ben `get_exercise` hívás `topic: "word_problem"` bemenettel.

- [ ] **Step 7: Az eval futtatása (a Task 8-ból)**

Run: `npx eve eval get-exercise`
Expected: kilépési kód 0, `calledTool(get_exercise)` passed. Ha elbukik, jöhet a Task 8 Step 3 (egy sor az `instructions.md`-be), majd újrafuttatás.

---

### Task 10: Élesítés Vercelen (a felhasználó jóváhagyásával)

Minden lépés előtt kérdezd meg a felhasználót. A deploy és a környezeti változók beállítása kifelé ható művelet.

- [ ] **Step 0: Vercel CLI** (a felhasználó)

Az `eve link` és az `eve deploy` a `vercel` parancsot hívja, ami jelenleg nincs telepítve, és nem-interaktív módban nem tud bejelentkezni.

Run: `npm i -g vercel@latest && vercel login`
Expected: a `vercel whoami` kiírja a felhasználó Vercel-nevét.

- [ ] **Step 1: A projekt összekötése**

Kérdezd meg a Vercel-projekt nevét, majd:

Run: `npx eve link --non-interactive --project <projektnév>`
Expected: kilépési kód 0. Ha 2-vel lép ki, futtasd a záró NDJSON-esemény `next.command` parancsát.

- [ ] **Step 2: Upstash Redis a projekthez** (a felhasználó, a Vercel dashboardon)

Vercel → a projekt → Storage → Upstash for Redis → Connect. Utána:

Run: `vercel env ls production`
Expected: megjelenik a `KV_REST_API_URL` és a `KV_REST_API_TOKEN` (vagy az `UPSTASH_REDIS_REST_URL` és az `UPSTASH_REDIS_REST_TOKEN`). Ha más nevek jelennek meg, igazítsd hozzájuk az `agent/lib/exercise-store.ts`-t.

- [ ] **Step 3: Környezeti változók** (a felhasználó gépeli be az értékeket)

```bash
vercel env add ANTHROPIC_API_KEY production
vercel env add GMAIL_USER production
vercel env add GMAIL_APP_PASSWORD production
vercel env add EXERCISE_RECIPIENTS production
```

Az `EXERCISE_RECIPIENTS` értéke a három cím, vesszővel elválasztva. A `GMAIL_APP_PASSWORD` mehet szóközökkel is, a kód kiszedi őket. A `DAILY_EXERCISE_DEV`-et éles környezetben NEM szabad beállítani.

- [ ] **Step 4: Deploy**

Run: `npx eve deploy --non-interactive --yes`
Expected: kilépési kód 0 és egy production URL.

- [ ] **Step 5: Cron-ellenőrzés**

Vercel → a projekt → Settings → Cron Jobs. Expected: két job, `0 7 * * *` és `0 8 * * *`.

- [ ] **Step 6: Futásidő-korlát**

Vercel → a projekt → Settings → Functions. Expected: a Fluid Compute be van kapcsolva (alapértelmezett maximális futásidő 300 mp). Ha ki van kapcsolva, és a korlát csak 10 mp, a job (Redis, Claude, SMTP) félbeszakadhat: kapcsold be, vagy emeld a korlátot.

- [ ] **Step 7: Első éles reggel**

Másnap 9:00 és 10:00 között: Vercel → Observability → Logs. Expected: egy `[daily-exercise] sent` és egy `[daily-exercise] skipped-hour` sor, és a három címzett megkapta a levelet.
