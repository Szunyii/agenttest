# Napi feladat: résztvevők az adatbázisban – terv

Dátum: 2026-10-21
Előzmény: `docs/superpowers/specs/2026-10-20-reply-scoring-design.md` (válaszok pontozása, `submissions` tábla)

## Cél

A napi levél címzettjei az `EXERCISE_RECIPIENTS` env változó helyett egy `participants` táblából jönnek, amit a felhasználó kézzel kezel a Supabase felületén: felvesz valakit, megadja a nevét, és egy kapcsolóval eldönti, kapjon-e levelet. A pontokat egy `participant_scores` nézet gyűjti résztvevőnként (összpontszám, beküldések száma, átlag), a meglévő `submissions` táblából számolva.

## Nem cél

- Leiratkozás válaszlevéllel vagy linkkel; a résztvevőket csak a Supabase felületén lehet kezelni.
- Agent tool a résztvevők kezelésére.
- Az összpontszám vagy ranglista megjelenítése a levélben; mindenki továbbra is csak a saját előző pontszámát látja.
- Idegen kulcs a `submissions` és a `participants` között; a kapcsolat az e-mail cím és a környezet.
- Egy e-mail-cím megváltozásának automatikus követése (a régi pontokat kézzel lehet átírni).

## Döntések

| Kérdés | Döntés | Indok |
|---|---|---|
| Pontok | Számolt nézet (`participant_scores`) a `submissions`-ből | A felhasználó választása; mindig pontos, újrapontozásnál sem csúszik el |
| Dev és éles | `environment` oszlop a `participants` táblában | A felhasználó választása; ugyanúgy válik szét, mint a feladatok és a pontok |
| Kezelés | Kézzel a Supabase Table Editorban | A felhasználó választása; néhány résztvevőnél ez a leggyorsabb, és nem kell hozzá kód |
| Név | Opcionális `name` oszlop, megszólítás a levélben | A felhasználó választása |
| Kapcsolat a pontokkal | E-mail cím + környezet (nincs idegen kulcs) | A legkisebb változás; a meglévő pontok rögtön látszanak; a válaszok úgyis cím alapján érkeznek |
| Hibás cím | Az adatbázis elutasítja (CHECK) | Egy elgépelt sor különben minden reggel megállítaná a jobot; így már mentéskor kiderül |
| Üres lista | Nincs feladat, nincs levél, eredmény: `no-recipients` | A kikapcsolt lista szüneteltet |
| Új résztvevő | Nincs „nem küldtél megoldást” sor, ha az előző feladat a felvétele előtt ment ki | Az a feladat nem neki ment; az első éles napon a régi típusú feladatnál sem kap senki hamis üzenetet |

## Adatmodell

Új tábla: `participants` (Prisma-modell: `Participant`).

| Mező | Típus | Tartalom |
|---|---|---|
| `id` | egész, automatikus | azonosító |
| `environment` | enum: `production`, `development` | melyik futás küld neki |
| `email` | szöveg | kisbetűs cím |
| `name` | szöveg, üres is lehet | megszólításhoz |
| `active` | logikai, alapértelmezés: igaz | kapjon-e levelet |
| `createdAt` | időbélyeg, alapértelmezés: most | mikor került a listára |

Egyedi: `(environment, email)`. A migráció kézzel írt CHECK-megszorításokkal (a Prisma-sémában nem fejezhetők ki, de a Prisma nem is törli őket) biztosítja, hogy:

- az `email` kisbetűs és nincs körülötte szóköz: `email = lower(btrim(email))`;
- az `email` formátuma érvényes: `email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'` (ugyanaz a szabály, mint a kódban).

Az RLS be van kapcsolva, szabályok nélkül, mint a többi táblán. A migráció nem tartalmaz címeket: a sorokat a felhasználó veszi fel.

## Nézet: `participant_scores`

```sql
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

A `security_invoker` miatt a nézetet olvasó szerepkörre a táblák RLS-e vonatkozik, így a Supabase nyilvános API-ján üres; a Prisma (tulajdonos) és a Supabase felülete látja. A nézetet a kód nem olvassa, csak a felhasználónak szól; a Prisma-sémába nem kerül be.

## Felépítés

| Fájl | Változás |
|---|---|
| `prisma/schema.prisma` | módosul: `Participant` modell |
| `prisma/migrations/` | *új* migráció: `participants` tábla, egyedi index, CHECK-megszorítások, RLS, `participant_scores` nézet |
| `agent/lib/daily-exercise.ts` | módosul: `Recipient { email, name, since }` a sima címek helyett (`since` = a résztvevő `createdAt`-je); a `parseRecipients(env)` helyett `normalizeRecipients(rows)` (kisbetű, szóköz, ismétlődés, formátum); új eredmény: `no-recipients`; új score-sor: `new` (nem jelenik meg); a `composeEmail` névvel köszön |
| `agent/lib/exercise-repository.ts` | módosul: új `getRecipients()` → az adott környezet aktív résztvevői, `id` szerint |
| `agent/lib/daily-exercise-job.ts` | módosul: az `EXERCISE_RECIPIENTS` helyett `normalizeRecipients(await repository.getRecipients())`; a válaszok kiválasztásához a címek listája |
| `tests/daily-exercise.test.ts` | módosul: címzett-objektumok, új tesztek |

A `replies.ts`, az `inbox.ts`, a `grader.ts` és a `mailer.ts` nem változik: a válaszok kiválasztása továbbra is címlistával dolgozik (`recipients.map((r) => r.email)`).

## Napi folyamat

1. A job betölti az adott környezet aktív résztvevőit, és normalizálja őket.
2. Ha nem 9 óra van (és nem fejlesztői mód): `skipped-hour`, mint most.
3. `getPrevious()`; ha a mai levél már kiment: `already-sent`, mint most.
4. Ha nincs aktív résztvevő: `no-recipients` (nincs generálás, beszúrás és levél).
5. Pontozás és generálás, majd küldés, mint most. Címzettenként a score-sor:
   - `graded`, `none`, `unknown`, mint most;
   - `new`, ha a résztvevő `since` időpontja az előző feladat `createdAt`-je utáni, és nincs tőle tárolt pontszám vagy válasz.

A résztvevők betöltése a 9 órás ellenőrzés előtt történik (naponta két cron-hívás, egy olcsó lekérdezés), így a mag tiszta marad: a címzetteket továbbra is a `deps.recipients` adja.

## A levél

- Megszólítás: `Szia Anna!`, ha van `name`, különben `Szia!`.
- `new` score-sor: nincs pontszám-bekezdés; az „Az előző feladat” blokk (a megoldással) megmarad.
- Minden más változatlan.

## Hibakezelés

| Eset | Következmény |
|---|---|
| A résztvevők lekérdezése elbukik | A job hibával leáll (mint bármely más adatbázis-hiba a futás elején) |
| Nincs aktív résztvevő | `no-recipients`, nincs levél és nincs új feladat |
| Elgépelt vagy nagybetűs cím a Supabase-ben | Mentéskor hibát ad a CHECK-megszorítás; a job nem is látja |
| Ismétlődő cím (pl. eltérő kis-nagybetű a megszorítás előtt) | A `normalizeRecipients` kiszűri |
| Kikapcsolt résztvevő válaszol egy régi levélre | Nem pontozódik (nincs a címzettek között); a korábbi pontjai a nézetben maradnak |
| Résztvevő e-mail-címe megváltozik | A régi pontok a régi címhez tartoznak; a `submissions` sorait kézzel lehet átírni |

## Tesztelés

- Unit tesztek (`node --test`):
  - `normalizeRecipients`: kisbetű és szóköz, ismétlődés kiszűrése (az első marad), hibás formátum elutasítása, név és `since` megtartása
  - `runDailyExercise`: `no-recipients` üres listánál (nincs generálás és küldés); a 9 órás és az `already-sent` ellenőrzés előbb fut
  - `composeEmail`: `Szia Anna!` névvel, `Szia!` név nélkül, a `new` sor nem jelenik meg
  - `scorePrevious`: új résztvevő → `new`; ha mégis van tőle válasz, pontozódik
  - a meglévő tesztek a címzett-objektumokkal
- Migráció: `prisma validate`, offline `migrate diff` a tábla részére; a CHECK-megszorítások és a nézet kézzel írt SQL
- Helyi próba: a felhasználó felveszi a saját címét `development` környezettel, a dev futás csak neki küld, a `participant_scores` nézet mutatja a pontjait, és egy nagybetűs vagy hibás cím mentése hibát ad

## Beállítás

- A migrációt a felhasználó futtatja: `npx prisma migrate deploy`.
- A felhasználó felveszi a résztvevőket a Supabase Table Editorban: helyi próbához a saját címét `development`-ként, élesben a valódi címzetteket `production`-ként.
- Az `EXERCISE_RECIPIENTS` env változó megszűnik: törölhető a `.env.development.local`-ból, és élesben nem kell felvenni a Vercelre.
