# Napi feladat: résztvevők az adatbázisban – megvalósítási terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A napi levél címzettjei az `EXERCISE_RECIPIENTS` env változó helyett a kézzel kezelt `participants` táblából jönnek (név, aktív kapcsoló, környezet), a pontokat pedig a `participant_scores` nézet összesíti.

**Architecture:** A tiszta mag (`agent/lib/daily-exercise.ts`) `Recipient { email, name, since }` objektumokat kap a sima címek helyett; a `normalizeRecipients` kisbetűsít, kiszűri az ismétlődést és elutasítja a hibás címet. Üres listánál `no-recipients` az eredmény; aki az előző feladat után került a listára, annak a levelében nincs score-sor (`new`); a levél néven köszön. A repository `getRecipients()` az adott környezet aktív résztvevőit adja, a job ezt köti be. A tábla CHECK-megszorításai és a nézet kézzel írt SQL a migrációban.

**Tech Stack:** Prisma 7.10.0, Supabase Postgres 17, Node 24 (`node --test`), TypeScript.

Spec: `docs/superpowers/specs/2026-10-21-participants-table-design.md`
Előzmény: `docs/superpowers/plans/2026-10-20-reply-scoring.md` (a jelenlegi kód ezen alapul)

**Tények:**

- A tesztek `node --test`-tel futnak típus-eltávolítással, `.ts` kiterjesztéssel importálnak; a `daily-exercise.ts`-ben ezért csak `import type` lehet relatív import.
- A Prisma-séma nem tud CHECK-megszorítást és nézetet kifejezni; a kézzel írt SQL a migrációban marad, a `migrate deploy` lefuttatja, a Prisma nem törli őket.
- Az auto mode a `npx prisma migrate deploy`-t éles deploynak minősíti, ezért azt **a felhasználó futtatja** (4. task).
- A jelenlegi tesztszám 60 (`tests/daily-exercise.test.ts`: 42, `tests/replies.test.ts`: 18).

**Git:** a munka a `feature/participants-table` ágon folyik. Taskonként csak a felsorolt fájlokat add hozzá, soha ne `git add -A`-t. A `.env.development.local` tartalmát ne írd ki.

**Typecheck:** a 2. task után a `npx tsc` a `daily-exercise-job.ts`-ben hibát ad (a `parseRecipients` megszűnik); a 3. task végén lesz újra zöld.

---

## Fájlszerkezet

| Fájl | Művelet | Felelősség |
|---|---|---|
| `prisma/schema.prisma` | módosít | `Participant` modell |
| `prisma/migrations/20261021000000_participants/migration.sql` | új | tábla, egyedi index, CHECK-ek, RLS, `participant_scores` nézet |
| `agent/lib/daily-exercise.ts` | módosít | `Recipient`, `normalizeRecipients`, `no-recipients`, `new` score-sor, megszólítás |
| `tests/daily-exercise.test.ts` | módosít | a mag tesztjei címzett-objektumokkal és új esetekkel |
| `agent/lib/exercise-repository.ts` | módosít | `getRecipients()` |
| `agent/lib/daily-exercise-job.ts` | módosít | bekötés, az env változó megszűnik |
| `docs/superpowers/plans/2026-10-15-supabase-prisma-store.md` | módosít | az éles env-lista frissítése (5. task) |

---

### Task 1: Adatbázis – `participants` tábla és `participant_scores` nézet

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261021000000_participants/migration.sql`

- [ ] **Step 1: A séma**

A `prisma/schema.prisma` végére:

```prisma
model Participant {
  id          Int         @id @default(autoincrement())
  environment Environment
  // Lowercased; the migration also checks the format.
  email       String
  name        String?
  active      Boolean     @default(true)
  createdAt   DateTime    @default(now()) @map("created_at")

  @@unique([environment, email])
  @@map("participants")
}
```

- [ ] **Step 2: A migráció**

`prisma/migrations/20261021000000_participants/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "participants" (
    "id" SERIAL NOT NULL,
    "environment" "Environment" NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "participants_environment_email_key" ON "participants"("environment", "email");

-- Rows are added by hand in Supabase, so the database refuses what the job
-- could not send to: a padded or mixed-case address, or a malformed one (the
-- same rule as normalizeRecipients). Prisma cannot express these checks and
-- leaves them alone.
ALTER TABLE "participants"
  ADD CONSTRAINT "participants_email_normalized"
    CHECK ("email" = lower(btrim("email"))),
  ADD CONSTRAINT "participants_email_format"
    CHECK ("email" ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');

-- Same as the other tables: with RLS on and no policies, only the database
-- owner (Prisma) can read or write the table through Supabase's REST API.
ALTER TABLE "participants" ENABLE ROW LEVEL SECURITY;

-- Points per participant, computed from the graded replies. security_invoker
-- applies the tables' RLS to whoever reads the view, so Supabase's REST API
-- sees nothing, while the owner (Prisma, the dashboard) sees everything.
CREATE VIEW "participant_scores" WITH (security_invoker = true) AS
SELECT
  p."environment",
  p."email",
  p."name",
  p."active",
  count(s."id") AS "submissions",
  coalesce(sum(s."score"), 0) AS "total_score",
  round(avg(s."score"), 1) AS "average_score",
  max(s."received_at") AS "last_reply_at"
FROM "participants" p
LEFT JOIN (
  "submissions" s
  JOIN "daily_exercises" e ON e."id" = s."exercise_id"
) ON e."environment" = p."environment" AND s."email" = p."email"
GROUP BY p."id";
```

- [ ] **Step 3: Ellenőrzés**

Run: `npx prisma validate && npx prisma generate 2>&1 | tail -2`
Expected: `The schema at prisma/schema.prisma is valid`, majd `Generated Prisma Client`.

Run: `git show HEAD:prisma/schema.prisma > "${TMPDIR:-/tmp}/old-schema.prisma" && npx prisma migrate diff --from-schema "${TMPDIR:-/tmp}/old-schema.prisma" --to-schema prisma/schema.prisma --script`
Expected: ugyanaz a `CREATE TABLE "participants"` és `CREATE UNIQUE INDEX`, mint a migráció eleje (a CHECK-ek, az RLS és a nézet nélkül). Eltérésnél a Prisma kimenete a mérvadó a tábla és az index részére; a kézzel írt részek maradnak. Ez a parancs nem kapcsolódik adatbázishoz.

Run: `npx tsc; echo "tsc exit: $?"; npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `tsc exit: 0`, `pass 60`, `fail 0`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261021000000_participants/migration.sql
git commit -m "feat: add a participants table and a participant_scores view"
```

---

### Task 2: A mag – címzett-objektumok, üres lista, új résztvevő, megszólítás

**Files:**
- Modify: `agent/lib/daily-exercise.ts`
- Test: `tests/daily-exercise.test.ts`

- [ ] **Step 1: A tesztek átírása (failing)**

a) Az import: a `parseRecipients` helyett `normalizeRecipients`, és a típusok közé `type Recipient`:

```ts
import {
  budapestClock,
  composeEmail,
  normalizeRecipients,
  resolveRunMode,
  runDailyExercise,
  type DailyExerciseDeps,
  type ExerciseRecord,
  type Grade,
  type NewExerciseRecord,
  type OutgoingMail,
  type Recipient,
  type ScoreLine,
  type StoredScore,
} from "../agent/lib/daily-exercise.ts";
```

b) A `graded` konstans alá:

```ts
// Everyone in the fixtures joined well before the previous exercise.
const joined = new Date("2026-10-01T00:00:00Z");

function recipient(
  email: string,
  name: string | null = null,
  since = joined,
): Recipient {
  return { email, name, since };
}
```

c) A `fakeDeps`-ben a `recipients` sor:

```ts
    recipients: [recipient("a@example.com"), recipient("b@example.com")],
```

d) A `describe("parseRecipients", ...)` blokk helyére:

```ts
describe("normalizeRecipients", () => {
  it("lowercases and trims addresses and names", () => {
    assert.deepEqual(
      normalizeRecipients([recipient(" Anna@Example.COM ", " Anna ")]),
      [recipient("anna@example.com", "Anna")],
    );
  });

  it("keeps the first of repeated addresses, ignoring letter case", () => {
    assert.deepEqual(
      normalizeRecipients([
        recipient("a@example.com", "Első"),
        recipient("A@Example.com", "Második"),
        recipient("b@example.com"),
      ]),
      [recipient("a@example.com", "Első"), recipient("b@example.com")],
    );
  });

  it("turns a blank name into null", () => {
    assert.equal(normalizeRecipients([recipient("a@example.com", "  ")])[0].name, null);
  });

  it("rejects a malformed address before anything is sent", () => {
    assert.throws(
      () => normalizeRecipients([recipient("a@example.com"), recipient("anna@gmail")]),
      /Malformed participant address: anna@gmail/,
    );
  });

  it("accepts an empty list", () => {
    assert.deepEqual(normalizeRecipients([]), []);
  });
});
```

e) A `describe("composeEmail", ...)` blokk végére (az „asks for the solution as a reply” teszt után):

```ts
  it("greets the recipient by name", () => {
    const mail = composeEmail(previous, graded, today, "2026-10-15", "Anna");

    assert.ok(mail.text.startsWith("Szia Anna!\n\n"));
  });

  it("greets without a name when there is none", () => {
    const mail = composeEmail(previous, graded, today, "2026-10-15", null);

    assert.ok(mail.text.startsWith("Szia!\n\n"));
  });

  it("leaves out the score line for a new participant", () => {
    const mail = composeEmail(previous, { kind: "new" }, today, "2026-10-15", null);

    assert.ok(mail.text.includes("Megoldás: Előző megoldás"));
    assert.ok(!mail.text.includes("Pontszámod"));
    assert.ok(!mail.text.includes("nem küldtél"));
    assert.ok(!mail.text.includes("nem sikerült"));
  });
```

f) A „matches recipients to replies case-insensitively” tesztben a `recipients: ["A@Example.com"],` sor helyére:

```ts
      recipients: [recipient("A@Example.com")],
```

g) A `describe("runDailyExercise", ...)` blokkban a „sends the first email without a previous block and reads no replies” teszt után:

```ts
  it("pauses without generating or sending when nobody is active", async () => {
    const { deps, calls, delivered } = fakeDeps({ recipients: [] });

    assert.equal(await runDailyExercise(deps), "no-recipients");
    assert.ok(!calls.includes("fetchReplies"));
    assert.ok(!calls.includes("generate"));
    assert.deepEqual(delivered, []);
  });

  it("checks the hour before the empty list", async () => {
    const { deps } = fakeDeps({
      recipients: [],
      now: new Date("2026-12-01T07:30:00Z"), // 08:30 in Budapest (CET)
    });

    assert.equal(await runDailyExercise(deps), "skipped-hour");
  });

  it("skips the score line for someone who joined after the previous exercise", async () => {
    const { deps, delivered } = fakeDeps({
      recipients: [
        recipient("a@example.com"),
        recipient("c@example.com", null, new Date("2026-10-14T12:00:00Z")),
      ],
    });

    await runDailyExercise(deps);

    const newcomer = delivered[0].mails[1];

    assert.equal(newcomer.to, "c@example.com");
    assert.ok(newcomer.text.includes("Megoldás: Előző megoldás"));
    assert.ok(!newcomer.text.includes("nem küldtél"));
    assert.ok(!newcomer.text.includes("Pontszámod"));
    assert.ok(delivered[0].mails[0].text.includes("Pontszámod: 8/10"));
  });

  it("still grades a new participant's reply", async () => {
    const { deps, delivered } = fakeDeps({
      recipients: [recipient("c@example.com", null, new Date("2026-10-14T12:00:00Z"))],
      fetchReplies: async () =>
        new Map([["c@example.com", reply("c@example.com")]]),
    });

    await runDailyExercise(deps);

    assert.ok(delivered[0].mails[0].text.includes("Pontszámod: 8/10"));
  });

  it("greets recipients by name", async () => {
    const { deps, delivered } = fakeDeps({
      recipients: [recipient("a@example.com", "Anna")],
    });

    await runDailyExercise(deps);

    assert.ok(delivered[0].mails[0].text.startsWith("Szia Anna!\n\n"));
  });
```

- [ ] **Step 2: Futtasd, hogy elbukik**

Run: `node --test tests/daily-exercise.test.ts 2>&1 | tail -8`
Expected: FAIL; a `normalizeRecipients` nem létezik (a modul betöltésekor hiányzó export).

- [ ] **Step 3: Megvalósítás az `agent/lib/daily-exercise.ts`-ben**

a) Az `ExerciseRecord` interfész elé:

```ts
export interface Recipient {
  // Lowercased once normalizeRecipients has run.
  email: string;
  name: string | null;
  // When the participant joined; an exercise sent earlier was not theirs.
  since: Date;
}
```

b) A `ScoreLine` típus:

```ts
// What a recipient's email says about their answer to the previous exercise.
export type ScoreLine =
  | ({ kind: "graded" } & Grade)
  | { kind: "none" } // no reply arrived
  | { kind: "unknown" } // reading or grading the reply failed
  | { kind: "new" }; // joined after the previous exercise was sent
```

c) A `DailyExerciseDeps`-ben: `recipients: Recipient[];` (a `string[]` helyett).

d) Az eredménytípus:

```ts
export type DailyExerciseResult =
  | DeliveryResult
  | "skipped-hour"
  | "no-recipients";
```

e) A `parseRecipients` függvény helyére:

```ts
// Lowercases and trims the addresses, keeps the first of any repeated address
// and refuses a malformed one: Gmail would refuse it too, rolling back the
// delivery every day. The database checks the same rules on input.
export function normalizeRecipients(rows: Recipient[]): Recipient[] {
  const seen = new Set<string>();
  const recipients: Recipient[] = [];

  for (const row of rows) {
    const email = row.email.trim().toLowerCase();

    if (seen.has(email)) {
      continue;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error(`Malformed participant address: ${email}`);
    }

    seen.add(email);
    recipients.push({ ...row, email, name: row.name?.trim() || null });
  }

  return recipients;
}
```

f) A `describeScore` paramétere: `score: Exclude<ScoreLine, { kind: "new" }>`.

g) A `composeEmail`:

```ts
export function composeEmail(
  previous: ExerciseRecord | null,
  score: ScoreLine,
  today: Pick<GeneratedExercise, "exercise">,
  date: string,
  name: string | null = null,
): { subject: string; text: string } {
  const [year, month, day] = date.split("-");
  const sections = [name ? `Szia ${name}!` : "Szia!"];

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

    if (score.kind !== "new") {
      sections.push(describeScore(score));
    }
  }
```

(a függvény többi része változatlan).

h) A `scorePrevious`-ben a címzett-ciklus eleje és a válasz nélküli ág:

```ts
  await Promise.all(
    deps.recipients.map(async (recipient) => {
      const email = recipient.email.toLowerCase();
      const reply = replies?.get(email);
      const known = stored.get(email);
```

a `lines.set(recipient, ...)` hívásokban a kulcs mindenhol `recipient.email` (a `recipient` helyett), és a `if (!reply) { ... }` ág:

```ts
      if (!reply) {
        // An exercise sent before the participant joined was not theirs.
        if (recipient.since > previous.createdAt) {
          lines.set(recipient.email, { kind: "new" });
          return;
        }

        // Without the inbox we cannot tell whether a reply arrived.
        lines.set(recipient.email, { kind: replies ? "none" : "unknown" });
        return;
      }
```

i) A `runDailyExercise`-ben az `already-sent` ellenőrzés után:

```ts
  // An empty list pauses the emails: no exercise is generated or stored.
  if (deps.recipients.length === 0) {
    return "no-recipients";
  }
```

és a levelek építése:

```ts
  return deps.deliver({ ...today, slot, date: clock.date }, (exerciseId) =>
    deps.recipients.map((recipient) => ({
      to: recipient.email,
      messageId: deps.newMessageId(exerciseId),
      ...composeEmail(
        previous,
        scores.get(recipient.email) ?? { kind: "unknown" },
        today,
        clock.date,
        recipient.name,
      ),
    })),
  );
```

- [ ] **Step 4: Futtasd, hogy átmegy**

Run: `npx --no-install prettier --write agent/lib/daily-exercise.ts tests/daily-exercise.test.ts`
Run: `node --test tests/daily-exercise.test.ts 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: `tests 51`, `pass 51`, `fail 0`.

Run: `npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"; npx tsc 2>&1 | grep "error TS"`
Expected: `tests 69`, `pass 69`, `fail 0`; `tsc` hiba csak a `agent/lib/daily-exercise-job.ts`-ben (a `parseRecipients` import és a `recipients` típusa).

- [ ] **Step 5: Commit**

```bash
git add agent/lib/daily-exercise.ts tests/daily-exercise.test.ts
git commit -m "feat: send to participant records with names and pause on an empty list"
```

---

### Task 3: Repository és a job bekötése

**Files:**
- Modify: `agent/lib/exercise-repository.ts`
- Modify: `agent/lib/daily-exercise-job.ts`

- [ ] **Step 1: A repository**

Az `agent/lib/exercise-repository.ts` típusimportjába vedd fel a `Recipient`-et (`./daily-exercise`), és a visszaadott objektumban a `getPrevious` elé:

```ts
    // Who gets today's email: the environment's active participants.
    async getRecipients(): Promise<Recipient[]> {
      const rows = await prisma.participant.findMany({
        where: { environment, active: true },
        orderBy: { id: "asc" },
      });

      return rows.map((row) => ({
        email: row.email,
        name: row.name,
        since: row.createdAt,
      }));
    },
```

- [ ] **Step 2: A job**

Az `agent/lib/daily-exercise-job.ts`-ben:

a) Az importban a `parseRecipients` helyett `normalizeRecipients`.

b) Töröld a `const recipients = parseRecipients(requireEnv("EXERCISE_RECIPIENTS"));` sort, és a `repository` létrehozása után vedd fel:

```ts
    // Loaded before the 9 o'clock check: a cheap query, and the core stays pure.
    const recipients = normalizeRecipients(await repository.getRecipients());
    const emails = recipients.map((recipient) => recipient.email);
```

c) A `fetchReplies`-ben a célpont címlistája az `emails`:

```ts
        const target = {
          environment,
          exerciseId: previous.id,
          recipients: emails,
        };
```

(a `runDailyExercise({ ... recipients, ... })` sor marad: az most a `Recipient[]`-et adja át).

- [ ] **Step 3: Ellenőrzés**

Run: `npx --no-install prettier --write agent/lib/exercise-repository.ts agent/lib/daily-exercise-job.ts`
Run: `npx tsc; echo "tsc exit: $?"; npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"; npx eve info 2>&1 | grep -iE "error|warning|schedule" | head -5`
Expected: `tsc exit: 0`; `tests 69`, `pass 69`, `fail 0`; az `eve info` 0 hibát és 2 schedule-t mutat.

Run: `grep -rn "EXERCISE_RECIPIENTS\|parseRecipients" agent tests`
Expected: nincs találat.

- [ ] **Step 4: Commit**

```bash
git add agent/lib/exercise-repository.ts agent/lib/daily-exercise-job.ts
git commit -m "feat: load the daily recipients from the participants table"
```

---

### Task 4: Helyi próba (a felhasználóval)

A titkokat ne írd ki. A levél csak a felhasználó saját címére mehet.

- [ ] **Step 1: Migráció** (a felhasználó)

A felhasználó futtatja a saját terminálában: `npx prisma migrate deploy`
Expected: `Applying migration 20261021000000_participants`, `All migrations have been successfully applied.`

- [ ] **Step 2: Résztvevők** (a felhasználó, Supabase Table Editor → `participants`)

- Új sor: `environment` = `development`, `email` = a saját iCloud-címe (kisbetűvel), `name` = a keresztneve, `active` = igaz.
- Próbaként próbáljon menteni egy `Proba@Example.com` vagy `anna@gmail` címet: a mentés hibát kell adjon (CHECK), utána a próbasort ne mentse el.
- Az `.env.development.local`-ból törölheti az `EXERCISE_RECIPIENTS` sort (a kód már nem olvassa).

- [ ] **Step 3: Dev futás**

Run (háttérben): `npx eve dev --no-ui --logs all > "${TMPDIR:-/tmp}/eve-dev.log" 2>&1`, majd ha a `curl -s -o /dev/null -w "%{http_code}" --retry 60 --retry-connrefused --retry-delay 1 http://127.0.0.1:2000/` `200`-at ad:
Run: `curl -si -X POST --max-time 300 http://127.0.0.1:2000/eve/v1/dev/schedules/daily-exercise-summer | head -1; grep -E "daily-exercise|grader" "${TMPDIR:-/tmp}/eve-dev.log" | tail -5`
Expected: HTTP 200, `[daily-exercise] development: sent`; a levél „Szia <név>!” kezdetű, és csak a felhasználó címére ment. Ha az előző dev feladat a résztvevő felvétele előtt ment ki, a levélben nincs „nem küldtél megoldást” sor.

- [ ] **Step 4: Pontnézet** (csak olvas)

```bash
node --input-type=module -e '
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/package.json");
const pg = require("pg");
process.loadEnvFile(".env.development.local");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL.trim(), ssl: { rejectUnauthorized: false } });
await client.connect();
const { rows } = await client.query("SELECT environment, name, active, submissions, total_score, average_score FROM participant_scores ORDER BY environment, name");
console.table(rows);
await client.end();'
```

Expected: a felhasználó `development` sora; a pontjai a korábbi `submissions` sorokból (ha volt ilyen ezzel a címmel).

- [ ] **Step 5: Szüneteltetés** (opcionális)

A felhasználó kikapcsolja az `active`-ot, és egy újabb dev futás `development: no-recipients` eredményt naplóz, levél nélkül. Utána visszakapcsolja.

- [ ] **Step 6: A dev szerver leállítása.**

---

### Task 5: Dokumentáció

**Files:**
- Modify: `docs/superpowers/plans/2026-10-15-supabase-prisma-store.md`

- [ ] **Step 1: Az éles env-lista**

A 2026-10-15-ös terv „Task 8 / Step 3” listájából töröld a `vercel env add EXERCISE_RECIPIENTS production` sort, és a lista alatti „Az `EXERCISE_RECIPIENTS` a három cím vesszővel.” mondat helyére írd: „A címzetteket élesben a Supabase `participants` táblájában kell felvenni `production` környezettel (lásd `docs/superpowers/specs/2026-10-21-participants-table-design.md`); az `EXERCISE_RECIPIENTS` env változó megszűnt.”

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-10-15-supabase-prisma-store.md
git commit -m "docs: point the production setup to the participants table"
```
