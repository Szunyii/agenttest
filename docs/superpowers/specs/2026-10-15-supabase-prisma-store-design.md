# Napi feladat: Supabase + Prisma, „minden vagy semmi” – terv

Dátum: 2026-10-15
Előzmény: `docs/superpowers/specs/2026-10-14-daily-math-email-design.md` (a napi levél jelenlegi működése)

## Cél

A napi feladat tárolása az Upstash Redis helyett egy Supabase Postgres-adatbázisba kerül, Prismával. A mentés és a levélküldés egyetlen adatbázis-tranzakcióban történik: ha a küldés elbukik, a mentés sem marad meg, és párhuzamos futásból sem mehet ki két levél. Minden kiküldött feladat előzményként megmarad.

## Nem cél

- Az e-mail visszavonása (nem lehetséges). A „minden vagy semmi” itt azt jelenti: nincs mentés küldés nélkül, és nincs dupla küldés.
- Az agent általi tool-hívás a napi jobban. A feladatot ugyanaz a `generateExercise` írja, amit a `get_exercise` tool használ.
- A meglévő céges Supabase-projekt (éles termék) használata.

## Döntések

| Kérdés | Döntés | Indok |
|---|---|---|
| Cél | „Minden vagy semmi”: mentés + küldés egy egységként | A felhasználó választása |
| Megközelítés | Prisma interaktív tranzakció (`$transaction`) | Egyszerű, közvetlenül a Prisma garantálja |
| Adatbázis | A felhasználó saját, ingyenes Supabase-szervezetének új projektje | Elkülönül az éles terméktől; ingyenes |
| Prisma | 7.10.0, `@prisma/adapter-pg` illesztővel | Supabase-hez a Prisma 7 ezt használja |
| Duplikáció elleni védelem | Egyedi `slot` mező | Atomikus; a korábbi „ritkán dupla küldés” kockázatot is megszünteti |
| Upstash Redis | Kikerül | A Supabase kiváltja |

## Adatmodell

Tábla: `daily_exercises` (Prisma-modell: `DailyExercise`).

| Mező | Típus | Tartalom |
|---|---|---|
| `id` | egész, automatikus | azonosító |
| `environment` | enum: `production`, `development` | melyik környezet futása |
| `slot` | szöveg, **egyedi** | élesben a budapesti dátum (`2026-10-15`), fejlesztéskor ISO időbélyeg |
| `date` | `date` | a budapesti dátum |
| `difficulty` | szöveg | pl. `medium` |
| `topic` | szöveg | pl. `word_problem` |
| `exercise` | szöveg | a feladat |
| `solution` | szöveg | a megoldás (címke nélkül) |
| `createdAt` | időbélyeg, alapértelmezés: most | a mentés ideje |

A migráció bekapcsolja az RLS-t a táblán, szabályok nélkül, mert a Supabase a `public` séma tábláit nyilvános REST API-n is elérhetővé teszi. A Prisma adatbázis-tulajdonosként kapcsolódik, így őt ez nem érinti.

## Felépítés

| Fájl | Változás |
|---|---|
| `prisma/schema.prisma` | *új*: a `DailyExercise` modell és az `Environment` enum; generátor: `prisma-client`, a projekt gyökerében lévő, gitből kizárt mappába |
| `prisma.config.ts` | *új*: Prisma 7 konfiguráció; a CLI a `DIRECT_URL`-t használja, helyben a `.env.development.local`-ból |
| `prisma/migrations/` | *új*: a tábla és az RLS bekapcsolása |
| `agent/lib/db.ts` | *új*: Prisma-kliens a `@prisma/adapter-pg` illesztővel, `DATABASE_URL` alapján |
| `agent/lib/exercise-repository.ts` | *új*: `createExerciseRepository(environment, send)` → `getPrevious()` és `deliver(record, mail)` |
| `agent/lib/daily-exercise.ts` | módosul: a `saveLast` + `send` helyett egy `deliver` lépés; a `slot` itt számolódik |
| `agent/lib/daily-exercise-job.ts` | módosul: a repository bekötése, `DATABASE_URL` ellenőrzése |
| `agent/lib/exercise-store.ts` | *törlés* |
| `package.json` | `prisma` (dev), `@prisma/client`, `@prisma/adapter-pg` 7.10.0 (a `pg`-t az illesztő hozza); `postinstall: prisma generate`; a `@upstash/redis` kikerül |

## A mag új szerződése (`daily-exercise.ts`)

- `getPrevious(): Promise<ExerciseRecord | null>`: a környezet utoljára mentett feladata.
- `generate(): Promise<GeneratedExercise>`: `{ difficulty, topic, exercise, solution }`.
- `deliver(record: NewExerciseRecord, mail: OutgoingMail): Promise<"sent" | "already-sent">`: mentés és küldés egy tranzakcióban.
- A `slot` élesben a budapesti dátum, fejlesztői módban `now.toISOString()`.
- Az eredmény: `"sent" | "skipped-hour" | "already-sent"`.

## Napi folyamat

1. A job ellenőrzi a környezeti változókat (`DATABASE_URL`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `EXERCISE_RECIPIENTS`).
2. Ha Budapesten nem 9 óra van (és nem fejlesztői mód), kilép: `skipped-hour`.
3. `getPrevious()`. Ha élesben ennek a dátuma a mai, kilép: `already-sent`.
4. `generate()`: Claude írja a feladatot, az adatbázison kívül.
5. `deliver()`: egy tranzakcióban (90 mp-es korláttal, ami hosszabb a leglassabb, kb. 70 mp-es levélküldésnél) beszúrja a sort, majd elküldi a levelet. Ha a beszúrás egyedi-megkötés hibával (`P2002`) bukik el, `already-sent`, levél nélkül.
6. Sikeres lezárás: `sent`.
7. A futás végén (hiba esetén is) a job lezárja az adatbázis-kapcsolatot, mert napi egy futásnál a nyitva tartott kapcsolat nem hoz semmit, és a Fluid Compute felfüggesztése alatt elavulhat.

## Hibakezelés

| Hiba | Viselkedés |
|---|---|
| Az adatbázis nem érhető el (pl. szüneteltetett ingyenes projekt) | Hiba a 3. lépésnél; nincs generálás, nincs levél |
| Claude-hiba | Nincs mentés, nincs levél |
| Küldési hiba | A tranzakció visszagörgetődik; nincs mentés |
| Párhuzamos futás már beszúrta a mai sort | `already-sent`, levél nélkül |
| A levél kiment, de a lezárás elbukik | Ritka; a levél nem mentődik, a következő levélből kimarad az előző megoldás |

Minden hiba `[daily-exercise] failed` sorral kerül a naplóba, és a cron-futás a Vercelen hibásként látszik.

## Tesztelés

- Unit tesztek a magra: a meglévők az új `deliver` szerződéshez igazítva, plusz: generálási hibánál nincs `deliver`; a `deliver` `already-sent` eredménye visszajut; a `slot` élesben a dátum, fejlesztéskor időbélyeg.
- `eve info` és helyi `eve build --skip-sandbox-prewarm` (helyben nincs sandbox-szolgáltató; ez csak a csomagolást ellenőrzi): az eve fordítója becsomagolja-e a Prisma 7 klienst.
- Kézi próba helyben (fejlesztői mód): két futás, a második az első megoldásával kezdődik; egy futás szándékosan rossz App Password-del, utána nincs új sor a táblában.

## Beállítás

A felhasználó végzi; a titkos adatok a `.env.development.local`-ba kerülnek, nem a chatbe:

| Változó | Honnan | Hol kell |
|---|---|---|
| `DATABASE_URL` | Supabase → Connect → Transaction pooler (6543-as port) | helyben és a Vercelen |
| `DIRECT_URL` | Supabase → Connect → Session pooler (5432-es port) | csak helyben, a migrációkhoz |

A migráció helyben fut. A Vercelen az Upstash és a `KV_*` változók nem kellenek.

## Nyitott pont

- Elég-e a napi egy adatbázis-kapcsolat ahhoz, hogy a Supabase ne szüneteltesse az ingyenes projektet. Élesítés után az első héten figyelni kell.
