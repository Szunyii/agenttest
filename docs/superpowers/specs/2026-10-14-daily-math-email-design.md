# Napi matekfeladat e-mailben – terv

Dátum: 2026-10-14

## Cél

Az agent minden nap 9:00-kor (Europe/Budapest) e-mailben kiküld egy közepes nehézségű szöveges matekfeladatot egy háromfős címlistának. Minden levél az előző feladat megoldásával kezdődik. A modell Claude-ra vált.

Minta a feladat stílusára:

> Egy csiga minden nap 4 métert halad felfelé egy fán, éjszaka visszacsúszik 3 métert. Milyen magas a fa, ha a kilencedik napon éri el a tetejét?
>
> Megoldás: 8 nap alatt 8 métert jut feljebb, a 9. napon még 4 métert mászik, tehát a fa 12 méter magas.

## Nem cél

- A címzettek válaszainak fogadása vagy ellenőrzése (ehhez a Gmail-csatorna kellene: Pub/Sub, Redis, OAuth).
- HTML-sablon, leiratkozás, több címlista, felület a címlista szerkesztéséhez.

## Döntések

| Kérdés | Döntés | Indok |
|---|---|---|
| Megoldás | Másnap, a következő levél elején | A felhasználó választása |
| Megközelítés | Ütemezett kód + Gmail SMTP App Password-del | Kiszámítható, a téli/nyári időt kezeli, kevés beállítás |
| Modell | `anthropic("claude-sonnet-5-5")` az agentben és a generálásban is | A felhasználó Claude-ot kért; a Sonnet pontosan számol |
| Címzettek | Egy levél, a címzettek BCC-ben, `To`: a küldő saját címe | Nem látják egymás címét |
| Címlista | `EXERCISE_RECIPIENTS` környezeti változó, vesszővel elválasztva | Nem kerül gitbe, kód nélkül módosítható |
| Tárhely | Upstash Redis (Vercel Marketplace) | Az eve-ben nincs beépített tartós tár |
| Levél formátuma | Sima szöveg (UTF-8) | Elég, nincs szükség HTML-re |

## Felépítés

| Fájl | Felelősség |
|---|---|
| `agent/agent.ts` | Modell: `anthropic("claude-sonnet-5-5")` |
| `agent/lib/exercise.ts` *(új)* | `generateExercise({ difficulty, topic })` → `{ difficulty, topic, exercise, solution }`. A `get_exercise` mostani generáló logikája kiemelve, Claude-dal. Új téma: `word_problem`, a fenti csigás példával mint stílusmintával. Megmarad a kódban választott hiányzó paraméter és a véletlen „ötlet” számok. |
| `agent/tools/get_exercise.ts` | Vékony réteg a `generateExercise` fölött. A leírásban és a `topic` enumban megjelenik a `word_problem`. |
| `agent/lib/mailer.ts` *(új)* | `sendMail({ bcc, subject, text })` nodemailerrel, Gmail SMTP-n (`GMAIL_USER`, `GMAIL_APP_PASSWORD`). |
| `agent/lib/exercise-store.ts` *(új)* | `getLast()` / `saveLast(record)`. Egyetlen Redis-kulcs: `daily-exercise:last` (fejlesztői módban `daily-exercise:dev:last`), értéke JSON: `{ date: "YYYY-MM-DD", exercise, solution }`. |
| `agent/lib/daily-exercise.ts` *(új)* | `runDailyExercise()`: a napi folyamat (lent). |
| `agent/schedules/daily-exercise-summer.ts` *(új)* | `cron: "0 7 * * *"` (UTC) → `runDailyExercise()` |
| `agent/schedules/daily-exercise-winter.ts` *(új)* | `cron: "0 8 * * *"` (UTC) → `runDailyExercise()` |

A két schedule-fájl azért kell, mert a Vercel Hobby csomagban egy cron naponta csak egyszer futhat, és a megadott órán belül bárhol elsülhet. Mindkét fájl `run` handlert használ, `waitUntil`-be csomagolva.

## Napi folyamat (`runDailyExercise`)

1. Ellenőrzi a környezeti változókat; ha valamelyik hiányzik, a nevével együtt hibát dob.
2. Ha az aktuális óra Europe/Budapest szerint nem 9, naplóz és kilép. Így a két cronból mindig csak az egyik küld: Hobby csomagon 9:00 és 9:59 között, Pro csomagon 9:00-kor.
3. Betölti a `getLast()` rekordot. Ha a dátuma a mai budapesti dátum, kilép (újrapróbálkozáskor se legyen dupla küldés).
4. `generateExercise({ difficulty: "medium", topic: "word_problem" })`.
5. Összeállítja és elküldi a levelet (lent).
6. Csak sikeres küldés után: `saveLast({ date: ma, exercise, solution })`.

## A levél

Tárgy: `Napi matekfeladat – 2026. 10. 15.`

```
Szia!

Az előző feladat megoldása
--------------------------
<előző feladat szövege>

Megoldás: <előző megoldás>

Mai feladat
-----------
<mai feladat szövege>

A megoldást a következő levélben küldöm.
```

Az első napon (nincs előző rekord) az „Az előző feladat megoldása” blokk kimarad.

## Hibakezelés

| Hiba | Viselkedés |
|---|---|
| Hiányzó környezeti változó | Azonnali hiba a változó nevével |
| Claude-hiba | Az AI SDK beépített újrapróbálkozása után hiba; nincs küldés, nincs mentés |
| Küldési hiba | Hiba, nincs mentés. A következő levél az utoljára *kiküldött* feladat megoldását hozza, ezért „előző”, nem „tegnapi” a felirat |
| Mentési hiba sikeres küldés után | Hiba naplózva. Aznap nincs dupla küldés (a másik cron nem 9 órakor fut), de a következő levélből kimarad az előző megoldás |

## Fejlesztői mód

`DAILY_EXERCISE_DEV=1` (csak helyben):

- kihagyja a 9 órás és a „ma már ment” ellenőrzést,
- a `daily-exercise:dev:last` kulcsot használja, hogy ne írja felül az éles állapotot.

Helyben az `EXERCISE_RECIPIENTS` csak a fejlesztő saját címe.

## Tesztelés

- `tsc` typecheck.
- `evals/get-exercise.eval.ts`: a chatben feltett „adj egy matek példát” üzenetre a modell meghívja a `get_exercise`-t. Ha nem, a következő lépés egy sor az `instructions.md`-ben.
- Kézi futtatás `eve dev` alatt, fejlesztői módban: `curl -X POST http://localhost:2000/eve/v1/dev/schedules/daily-exercise-summer`; a levél megérkezik a saját címre, a második futás már az előző megoldással kezdődik.
- Élesben: a deploy utáni első reggel a Vercel logja és a postafiók.

## Beállítás

A felhasználó végzi (fiókok és titkos adatok):

1. Google-fiók: kétlépcsős azonosítás, majd App Password. Ha a küldő fiók céges Workspace-fiók, és az admin tiltja, a Gmail API-s (OAuth) megoldásra váltunk.
2. Anthropic API-kulcs.
3. Vercel-fiók; a projekt összekötése és a deploy (`eve link`, `eve deploy`) a felhasználó jóváhagyásával.
4. Upstash Redis a Vercel Marketplace-ről, a projekthez kötve.

Környezeti változók a Vercelen:

| Változó | Tartalom |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API-kulcs |
| `GMAIL_USER` | A küldő Gmail-cím |
| `GMAIL_APP_PASSWORD` | A Google App Password |
| `EXERCISE_RECIPIENTS` | A három cím, vesszővel elválasztva |
| Upstash Redis REST URL és token | A Marketplace-integráció állítja be |

Új függőségek: `nodemailer`, `@types/nodemailer`, `@upstash/redis`.

## Megvalósításkor ellenőrizendő

- Pontosan milyen nevű környezeti változókat állít be az Upstash-integráció, és ezeket olvassa-e a `Redis.fromEnv()`.
- Helyben milyen fájlból olvassa az `eve dev` a környezeti változókat.
