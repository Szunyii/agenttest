# Napi feladat: Supabase + Prisma – megvalósítási terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A napi feladat az Upstash Redis helyett a felhasználó saját Supabase-projektjébe kerül Prismával, és a mentés + levélküldés egyetlen tranzakcióban történik („minden vagy semmi”).

**Architecture:** A tiszta mag (`agent/lib/daily-exercise.ts`) egy `deliver(record, mail)` lépést hív, ami `"sent"` vagy `"already-sent"` értéket ad. A `agent/lib/exercise-repository.ts` ezt egy `prisma.$transaction`-nel valósítja meg: beszúrás, majd küldés. Ha a küldés elbukik, visszagörgetés. Ha egyedi `slot` ütközik (`P2002`), az `already-sent`. A Prisma-kliens a `@prisma/adapter-pg` illesztővel kapcsolódik a Supabase Transaction poolerhez.

**Tech Stack:** Prisma 7.10.0 (`prisma-client` generátor, `prisma.config.ts`, `@prisma/adapter-pg`), Supabase Postgres 17, eve 0.75, Node 24 (`node --test`), TypeScript.

Spec: `docs/superpowers/specs/2026-10-15-supabase-prisma-store-design.md`
Előzmény: `docs/superpowers/plans/2026-10-14-daily-math-email.md` (a jelenlegi kód ezen alapul)

**Ellenőrzött Prisma 7.10 tények** (a csomagok forrásából):

- A `prisma.config.ts` nem tölt be `.env` fájlt (`dotenv: false`).
- Az `env()` segédfüggvény hibát dob hiányzó változónál, ezért a konfiguráció `process.env.DIRECT_URL`-t használ, hogy a Vercelen a `postinstall`-beli `prisma generate` ne bukjon el.
- A `@prisma/adapter-pg` a Postgres 23505-ös hibáját `UniqueConstraintViolation`-ra fordítja, amit a kliens `P2002`-ként dob.
- A `pg` csomagot az illesztő hozza magával.
- `migrate diff` kapcsolók: `--from-empty`, `--to-schema`, `--script`, `--output`.

**Git:** a munka a `feature/supabase-prisma-store` ágon folyik. Taskonként csak a felsorolt fájlokat add hozzá (`git add <fájlok>`), soha ne `git add -A`-t. A felhasználó commitolatlan munkája maradjon érintetlen: `agent/instructions.md`, `agent/skills/`, `agent/tools/get_weather.ts`, `greeting.ts`, `web_search.ts`, `apps/`, `evals/current-weather.eval.ts`, `evals/evals.config.ts`, `skills-lock.json`.

---

## Fájlszerkezet

| Fájl | Művelet | Felelősség |
|---|---|---|
| `prisma/schema.prisma` | új | `DailyExercise` modell, `Environment` enum, generátor |
| `prisma.config.ts` | új | Prisma CLI konfiguráció; `.env.development.local` betöltése helyben |
| `prisma/migrations/migration_lock.toml` | új | provider rögzítése |
| `prisma/migrations/20261015000000_daily_exercises/migration.sql` | új | tábla, index, RLS |
| `.gitignore` | módosít | `generated/` kizárása |
| `package.json`, `package-lock.json` | módosít | Prisma-függőségek, `postinstall`, `@upstash/redis` törlése |
| `agent/lib/daily-exercise.ts` | módosít | új szerződés: `getPrevious`, `generate`, `deliver`; `slot` |
| `tests/daily-exercise.test.ts` | módosít | tesztek az új szerződéshez (19 teszt) |
| `agent/lib/db.ts` | új | lusta Prisma-kliens (`getPrisma()`) |
| `agent/lib/exercise-repository.ts` | új | `getPrevious` és tranzakciós `deliver` |
| `agent/lib/daily-exercise-job.ts` | módosít | repository bekötése, `DATABASE_URL` ellenőrzése |
| `agent/lib/exercise-store.ts` | töröl | Upstash-tároló |

---

### Task 1: Prisma-alapok (adatbázis nélkül)

**Files:**
- Create: `prisma/schema.prisma`, `prisma.config.ts`, `prisma/migrations/migration_lock.toml`, `prisma/migrations/20261015000000_daily_exercises/migration.sql`
- Modify: `.gitignore`, `package.json`, `package-lock.json`

- [ ] **Step 1: Függőségek**

Run: `npm install --save-exact @prisma/client@7.10.0 @prisma/adapter-pg@7.10.0 && npm install --save-exact --save-dev prisma@7.10.0`
Expected: kilépési kód 0. A `package.json`-ban: `"@prisma/client": "7.10.0"`, `"@prisma/adapter-pg": "7.10.0"` a `dependencies`-ben, `"prisma": "7.10.0"` a `devDependencies`-ben. (A `@upstash/redis` itt még marad, a Task 4 veszi ki.)

- [ ] **Step 2: `prisma/schema.prisma`**

```prisma
generator client {
  provider     = "prisma-client"
  output       = "../generated/prisma"
  moduleFormat = "esm"
}

datasource db {
  provider = "postgresql"
}

enum Environment {
  production
  development
}

model DailyExercise {
  id          Int         @id @default(autoincrement())
  environment Environment
  // Production: the Budapest date (one email per day). Dev: an ISO timestamp.
  slot        String      @unique
  date        DateTime    @db.Date
  difficulty  String
  topic       String
  exercise    String
  solution    String
  createdAt   DateTime    @default(now()) @map("created_at")

  @@index([environment, createdAt])
  @@map("daily_exercises")
}
```

- [ ] **Step 3: `prisma.config.ts` (projekt gyökér)**

```ts
import { defineConfig } from "prisma/config";

// Prisma does not load .env files itself; locally the secrets live here.
try {
  process.loadEnvFile(".env.development.local");
} catch {
  // No local file, e.g. on Vercel, where the platform provides the env vars.
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // `prisma generate` runs on Vercel without DIRECT_URL; only migrations need it.
  datasource: { url: process.env.DIRECT_URL },
});
```

- [ ] **Step 4: `.gitignore` és `postinstall`**

A `.gitignore` végére új sor: `generated`

A `package.json` `scripts` objektumába, a `"test": ...` sor után:

```json
    "postinstall": "prisma generate",
```

- [ ] **Step 5: Kliens generálása**

Run: `npx prisma generate`
Expected: kilépési kód 0, és létrejön a `generated/prisma/client.ts`.

- [ ] **Step 6: Migráció generálása adatbázis nélkül**

Run:
```bash
mkdir -p prisma/migrations/20261015000000_daily_exercises
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script --output prisma/migrations/20261015000000_daily_exercises/migration.sql
```
Expected: kilépési kód 0. A `migration.sql` tartalmazza: `CREATE TYPE "Environment" AS ENUM ('production', 'development');`, `CREATE TABLE "daily_exercises"`, a `slot` egyedi indexét és az `(environment, created_at)` indexet.

Utána fűzd a `migration.sql` végére:

```sql

-- Supabase exposes the public schema over its REST API; with RLS on and no
-- policies, only the database owner (Prisma) can read or write the table.
ALTER TABLE "daily_exercises" ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 7: `prisma/migrations/migration_lock.toml`**

```toml
# Please do not edit this file manually
# It should be added in your version-control system (e.g., Git)
provider = "postgresql"
```

- [ ] **Step 8: Ellenőrzés**

Run: `npx prisma validate; npx tsc --noEmit; echo "tsc exit: $?"; npm test`
Expected: a séma érvényes, `tsc exit: 0`, a tesztek 18/18 zöldek (a meglévő kód még változatlan).

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma.config.ts prisma/migrations .gitignore package.json package-lock.json
git commit -m "feat: add Prisma schema and migration for daily exercises

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: A mag új szerződése (TDD)

**Files:**
- Modify: `tests/daily-exercise.test.ts` (teljes csere)
- Modify: `agent/lib/daily-exercise.ts` (teljes csere)

- [ ] **Step 1: A teszt cseréje**

`tests/daily-exercise.test.ts` teljes új tartalma:

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
  type NewExerciseRecord,
  type OutgoingMail,
} from "../agent/lib/daily-exercise.ts";

const today = {
  difficulty: "medium",
  topic: "word_problem",
  exercise: "Mai feladat szövege",
  solution: "Mai megoldás",
};
const previous: ExerciseRecord = {
  date: "2026-10-14",
  exercise: "Előző feladat szövege",
  solution: "Előző megoldás",
};

function fakeDeps(overrides: Partial<DailyExerciseDeps> = {}) {
  const calls: string[] = [];
  const delivered: Array<{ record: NewExerciseRecord; mail: OutgoingMail }> =
    [];
  const deps: DailyExerciseDeps = {
    now: new Date("2026-10-15T07:05:00Z"), // 09:05 in Budapest (CEST)
    devMode: false,
    recipients: ["a@example.com", "b@example.com"],
    getPrevious: async () => {
      calls.push("getPrevious");
      return previous;
    },
    generate: async () => {
      calls.push("generate");
      return today;
    },
    deliver: async (record, mail) => {
      calls.push("deliver");
      delivered.push({ record, mail });
      return "sent";
    },
    ...overrides,
  };

  return { deps, calls, delivered };
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
    assert.ok(mail.text.includes("Megoldás: Előző megoldás"));
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
  it("generates and delivers at 9 in Budapest", async () => {
    const { deps, calls, delivered } = fakeDeps();

    assert.equal(await runDailyExercise(deps), "sent");
    assert.deepEqual(calls, ["getPrevious", "generate", "deliver"]);
    assert.deepEqual(delivered[0].record, {
      slot: "2026-10-15",
      date: "2026-10-15",
      ...today,
    });
    assert.deepEqual(delivered[0].mail.bcc, ["a@example.com", "b@example.com"]);
    assert.ok(delivered[0].mail.text.includes("Megoldás: Előző megoldás"));
    assert.ok(delivered[0].mail.text.includes("Mai feladat szövege"));
  });

  for (const [now, expected, expectedCalls] of [
    ["2026-12-01T07:30:00Z", "skipped-hour", []], // 08:30 in Budapest (CET)
    ["2026-12-01T08:59:00Z", "sent", ["getPrevious", "generate", "deliver"]], // 09:59 (CET)
    ["2026-07-01T07:59:00Z", "sent", ["getPrevious", "generate", "deliver"]], // 09:59 (CEST)
    ["2026-07-01T08:00:00Z", "skipped-hour", []], // 10:00 in Budapest (CEST)
  ] as const) {
    it(`returns ${expected} at ${now}`, async () => {
      const { deps, calls } = fakeDeps({ now: new Date(now) });

      assert.equal(await runDailyExercise(deps), expected);
      assert.deepEqual(calls, expectedCalls);
    });
  }

  it("skips when today's email has already been sent", async () => {
    const { deps, calls } = fakeDeps({
      getPrevious: async () => ({ ...previous, date: "2026-10-15" }),
    });

    assert.equal(await runDailyExercise(deps), "already-sent");
    assert.deepEqual(calls, []);
  });

  it("returns already-sent when a parallel run delivered first", async () => {
    const { deps } = fakeDeps({
      deliver: async () => "already-sent",
    });

    assert.equal(await runDailyExercise(deps), "already-sent");
  });

  it("does not deliver when generating fails", async () => {
    const { deps, delivered } = fakeDeps({
      generate: async () => {
        throw new Error("Claude down");
      },
    });

    await assert.rejects(runDailyExercise(deps), /Claude down/);
    assert.deepEqual(delivered, []);
  });

  it("propagates delivery failures", async () => {
    const { deps } = fakeDeps({
      deliver: async () => {
        throw new Error("SMTP down");
      },
    });

    await assert.rejects(runDailyExercise(deps), /SMTP down/);
  });

  it("uses a unique timestamp slot and skips the checks in dev mode", async () => {
    const { deps, delivered } = fakeDeps({
      devMode: true,
      now: new Date("2026-10-15T12:00:00Z"),
      getPrevious: async () => ({ ...previous, date: "2026-10-15" }),
    });

    assert.equal(await runDailyExercise(deps), "sent");
    assert.equal(delivered[0].record.slot, "2026-10-15T12:00:00.000Z");
    assert.equal(delivered[0].record.date, "2026-10-15");
  });
});
```

- [ ] **Step 2: A teszt bukásának ellenőrzése**

Run: `npm test`
Expected: FAIL. A `runDailyExercise` tesztek elbuknak, mert a mag még a régi `saveLast`/`send` függőségeket hívja (pl. `deps.saveLast is not a function`, vagy `calls` eltérés).

- [ ] **Step 3: `agent/lib/daily-exercise.ts` teljes cseréje**

```ts
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
```

- [ ] **Step 4: Tesztek**

Run: `npm test`
Expected: PASS, `# tests 19`, `# pass 19`, `# fail 0`.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit; echo "exit: $?"`
Expected: HIBA a `agent/lib/daily-exercise-job.ts`-ben (még a régi `getLast`/`saveLast`/`send` mezőket adja át). Ez várt, a Task 4 javítja. Más fájlban nem lehet hiba: ellenőrizd, hogy minden tsc-hiba a `daily-exercise-job.ts`-re mutat.

- [ ] **Step 6: Commit**

```bash
git add tests/daily-exercise.test.ts agent/lib/daily-exercise.ts
git commit -m "feat: deliver the daily exercise through one transactional step

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Prisma-kliens és repository

**Files:**
- Create: `agent/lib/db.ts`, `agent/lib/exercise-repository.ts`

Előfeltétel: Task 1 (a `generated/prisma` létezik; ha nem, futtasd: `npx prisma generate`).

- [ ] **Step 1: `agent/lib/db.ts`**

```ts
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../generated/prisma/client";

let client: PrismaClient | undefined;

// Created lazily, so a missing DATABASE_URL fails when the job runs, not when
// the module is imported, and warm serverless instances reuse one client.
export function getPrisma(): PrismaClient {
  if (!client) {
    const connectionString = process.env.DATABASE_URL?.trim();

    if (!connectionString) {
      throw new Error("Missing environment variable: DATABASE_URL");
    }

    client = new PrismaClient({
      adapter: new PrismaPg({
        connectionString,
        // Supabase's pooler strings carry no sslmode, so force TLS. The
        // pooler's CA is not in Node's trust store, so it is not verified.
        ssl: { rejectUnauthorized: false },
      }),
    });
  }

  return client;
}
```

- [ ] **Step 2: `agent/lib/exercise-repository.ts`**

```ts
import type {
  DeliveryResult,
  ExerciseRecord,
  NewExerciseRecord,
  OutgoingMail,
} from "./daily-exercise";
import { getPrisma } from "./db";

export type Environment = "production" | "development";

// The mailer's SMTP timeouts allow up to ~40 s; Prisma's default is 5 s.
const transactionTimeoutMs = 60_000;

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
          { timeout: transactionTimeoutMs },
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
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v "daily-exercise-job.ts" ; echo done`
Expected: a `daily-exercise-job.ts`-en kívül nincs tsc-hiba (az a Task 4-ben javul). Ha a `generated/prisma` kódjában vagy a két új fájlban hiba van, jelentsd a pontos hibát.

- [ ] **Step 4: Commit**

```bash
git add agent/lib/db.ts agent/lib/exercise-repository.ts
git commit -m "feat: store and send the daily exercise in one Prisma transaction

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: A job bekötése, az Upstash eltávolítása, build-ellenőrzés

**Files:**
- Modify: `agent/lib/daily-exercise-job.ts` (teljes csere)
- Delete: `agent/lib/exercise-store.ts`
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: `agent/lib/daily-exercise-job.ts` teljes cseréje**

```ts
import {
  parseRecipients,
  runDailyExercise,
  type DailyExerciseResult,
} from "./daily-exercise";
import { generateExercise } from "./exercise";
import { createExerciseRepository } from "./exercise-repository";
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
  }
}
```

- [ ] **Step 2: Az Upstash eltávolítása**

Run: `git rm agent/lib/exercise-store.ts && npm uninstall @upstash/redis`
Expected: kilépési kód 0; a `package.json`-ban nincs `@upstash/redis`. A `grep -rn "upstash\|exercise-store" agent tests` nem talál semmit.

- [ ] **Step 3: Typecheck, tesztek, eve**

Run: `npx tsc --noEmit; echo "tsc exit: $?"; npm test; npx eve info 2>&1 | head -60`
Expected: `tsc exit: 0`, 19/19 teszt zöld, `eve info`: 0 hiba, 0 figyelmeztetés, 2 schedule.

- [ ] **Step 4: Build-ellenőrzés (a Prisma-kliens becsomagolása)**

Run: `npx eve build; echo "build exit: $?"`
Expected: `build exit: 0`, és a kimenetben nincs `generated/prisma`, `@prisma/client` vagy `query_compiler` feloldási hiba. Ne futtasd az `eve deploy`-t. Ha a build hálózatot vagy hitelesítést kér, vagy Prisma-csomagolási hibát ad, állj meg, és jelentsd a pontos kimenetet (BLOCKED).

- [ ] **Step 5: Commit**

```bash
git add agent/lib/daily-exercise-job.ts package.json package-lock.json
git commit -m "feat: wire the Prisma repository into the daily job and drop Upstash

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Az `exercise-store.ts` törlése a `git rm` miatt már a stage-ben van.)

---

### Task 5: Dokumentáció

**Files:**
- Modify: `docs/superpowers/specs/2026-10-14-daily-math-email-design.md`, `docs/superpowers/plans/2026-10-14-daily-math-email.md`

- [ ] **Step 1: Hivatkozás a régi specben és tervben**

Mindkét fájlban a fő cím alá:

```md
> **2026-10-15:** a tárolás Upstash Redisről Supabase + Prismára változott („minden vagy semmi” tranzakció). Lásd `docs/superpowers/specs/2026-10-15-supabase-prisma-store-design.md` és `docs/superpowers/plans/2026-10-15-supabase-prisma-store.md`. Az Upstash-ra és a `KV_*` változókra vonatkozó részek elavultak.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-10-14-daily-math-email-design.md docs/superpowers/plans/2026-10-14-daily-math-email.md
git commit -m "docs: point the daily email docs to the Supabase store

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Adatbázis beállítása (a felhasználóval)

A titkos adatokat a felhasználó írja be a `.env.development.local`-ba; a végrehajtó nem kéri be a chatben.

- [ ] **Step 1: A felhasználó kitölti a `.env.development.local`-t**

A Supabase-projektben: **Connect** → **Connection string**, a „Transaction pooler” és a „Session pooler” sima URI-ja, a jelszóval kiegészítve. A Prisma-fül változata `?pgbouncer=true`-t tesz a végére, ami a `pg` illesztőnek nem kell. A `DATABASE_URL` ne tartalmazzon `sslmode` paramétert: az felülírná a `db.ts` TLS-beállítását, és a `require` értéket a `pg` teljes tanúsítvány-ellenőrzésként értelmezné, ami a Supabase poolerén elbukik.

```
DATABASE_URL=<Transaction pooler, 6543-as port, jelszóval>
DIRECT_URL=<Session pooler, 5432-es port, jelszóval>
ANTHROPIC_API_KEY=<Anthropic API-kulcs>
GMAIL_USER=<küldő Gmail-cím>
GMAIL_APP_PASSWORD=<App Password>
EXERCISE_RECIPIENTS=<a felhasználó SAJÁT címe>
DAILY_EXERCISE_DEV=1
```

- [ ] **Step 2: Migráció**

Run: `npx prisma migrate deploy`
Expected: `1 migration found` és `All migrations have been successfully applied.`

- [ ] **Step 3: Ellenőrzés**

Supabase → Table Editor: van `daily_exercises` (0 sor) és `_prisma_migrations` (1 sor) tábla, mindkettőn „RLS enabled” jelzéssel. Supabase → Advisors → Security: egyik táblára sincs „RLS disabled in public” figyelmeztetés.

Opcionális: mivel az adatbázist csak a Prisma használja, a Supabase nyilvános Data API-ja kikapcsolható (Project Settings → Data API). Így a `public` séma semmilyen formában nem érhető el kívülről.

---

### Task 7: Kézi végpontig tartó próba helyben (a felhasználóval)

- [ ] **Step 1: Dev szerver**

Run (a felhasználó, külön terminálban): `npm run dev`

- [ ] **Step 2: Első futás**

Run: `curl -si -X POST http://localhost:2000/eve/v1/dev/schedules/daily-exercise-summer`
Expected: `HTTP/1.1 200`, a logban `[daily-exercise] sent`, levél a saját címre előző-blokk nélkül, a táblában 1 `development` sor időbélyeges `slot`-tal. Ha a logban TLS-hiba áll (pl. `self-signed certificate`), vagy a kapcsolat titkosítatlan, állj meg és jelentsd: ez az első valódi próbája a `db.ts` `ssl` beállításának.

- [ ] **Step 3: Második futás**

Ugyanaz a parancs. Expected: HTTP 200, második levél „Az előző feladat megoldása” blokkal (az első feladattal és megoldással), a táblában 2 sor.

- [ ] **Step 4: Visszagörgetés próbája**

A `.env.development.local`-ban ideiglenesen írd át a `GMAIL_APP_PASSWORD`-öt egy rosszra, indítsd újra a dev szervert, és futtasd a parancsot.
Expected: `HTTP/1.1 500`, a logban `[daily-exercise] failed` egy `EAUTH` hibával, és a táblában továbbra is 2 sor, mert a beszúrás visszagörgetődött. Utána állítsd vissza a helyes jelszót.

- [ ] **Step 5: Chat és eval**

A dev chatben: „adj egy szöveges matek feladatot” → szöveges feladat megoldás nélkül, `get_exercise` hívással. Majd: `npx eve eval get-exercise` → kilépési kód 0.

---

### Task 8: Élesítés Vercelen (a felhasználó jóváhagyásával)

Minden lépés előtt kérdezd meg a felhasználót.

- [ ] **Step 1: Vercel CLI** (a felhasználó): `npm i -g vercel@latest && vercel login`; a `vercel whoami` kiírja a nevét.
- [ ] **Step 2: Összekötés:** kérdezd meg a projekt nevét, majd `npx eve link --non-interactive --project <projektnév>`. Kilépési kód 2 esetén futtasd a záró NDJSON-esemény `next.command` parancsát.
- [ ] **Step 3: Környezeti változók** (a felhasználó gépeli be az értékeket):

```bash
vercel env add ANTHROPIC_API_KEY production
vercel env add GMAIL_USER production
vercel env add GMAIL_APP_PASSWORD production
vercel env add EXERCISE_RECIPIENTS production
vercel env add DATABASE_URL production
```

Az `EXERCISE_RECIPIENTS` a három cím vesszővel. A `DIRECT_URL` és a `DAILY_EXERCISE_DEV` NEM kell élesben.

- [ ] **Step 4: Deploy:** `npx eve deploy --non-interactive --yes` → kilépési kód 0. Figyelem: az `eve deploy` a munkakönyvtárat tölti fel, a felhasználó commitolatlan fájljaival együtt (pl. `agent/instructions.md`).
- [ ] **Step 5: Ellenőrzés:** Vercel → Settings → Cron Jobs: `0 7 * * *` és `0 8 * * *`; Settings → Functions: Fluid Compute bekapcsolva.
- [ ] **Step 6: Első éles reggel:** 9:00 és 10:00 között a Vercel logjában egy `[daily-exercise] sent` és egy `skipped-hour`; a címzettek megkapták a levelet; a táblában egy `production` sor a mai dátummal.
- [ ] **Step 7: Szüneteltetés figyelése:** az első héten ellenőrizd a Supabase-ben, hogy a projekt nem került „Paused” állapotba.
