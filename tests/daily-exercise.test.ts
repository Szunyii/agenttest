import assert from "node:assert/strict";
import { describe, it } from "node:test";

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
import type { InboundReply } from "../agent/lib/replies.ts";

const today = {
  difficulty: "medium",
  topic: "word_problem",
  exercise: "Mai feladat szövege",
  solution: "Mai megoldás",
};
const previous: ExerciseRecord = {
  id: 7,
  date: "2026-10-14",
  createdAt: new Date("2026-10-14T07:00:03Z"),
  exercise: "Előző feladat szövege",
  solution: "Előző megoldás",
};
const graded: ScoreLine = { kind: "graded", score: 8, feedback: "Szép munka." };
// Everyone in the fixtures joined well before the previous exercise.
const joined = new Date("2026-10-01T00:00:00Z");

function recipient(
  email: string,
  name: string | null = null,
  since = joined,
): Recipient {
  return { email, name, since };
}

function reply(from: string): InboundReply {
  return {
    from,
    messageId: `<reply-${from}>`,
    references: ["<development.7.abc@napi-matek>"],
    receivedAt: new Date("2026-10-14T18:00:00Z"),
    text: "12 méter",
    images: [],
    skippedImages: { unsupported: 0, tooLarge: 0, surplus: 0 },
  };
}

function fakeDeps(overrides: Partial<DailyExerciseDeps> = {}) {
  const calls: string[] = [];
  const delivered: Array<{ record: NewExerciseRecord; mails: OutgoingMail[] }> =
    [];
  const saved: Array<{ exerciseId: number; email: string; grade: Grade }> = [];
  const warnings: string[] = [];
  let messageIds = 0;
  const deps: DailyExerciseDeps = {
    now: new Date("2026-10-15T07:05:00Z"), // 09:05 in Budapest (CEST)
    devMode: false,
    recipients: [recipient("a@example.com"), recipient("b@example.com")],
    getPrevious: async () => {
      calls.push("getPrevious");
      return previous;
    },
    fetchReplies: async () => {
      calls.push("fetchReplies");
      return new Map([["a@example.com", reply("a@example.com")]]);
    },
    getScores: async () => {
      calls.push("getScores");
      return new Map<string, StoredScore>();
    },
    grade: async (_previous, answer) => {
      calls.push(`grade:${answer.from}`);
      return { score: 8, feedback: "Szép munka." };
    },
    saveScore: async (exerciseId, email, _answer, grade) => {
      calls.push(`saveScore:${email}`);
      saved.push({ exerciseId, email, grade });
    },
    generate: async () => {
      calls.push("generate");
      return today;
    },
    newMessageId: (exerciseId) =>
      `<test.${exerciseId}.${++messageIds}@napi-matek>`,
    deliver: async (record, buildMails) => {
      calls.push("deliver");
      delivered.push({ record, mails: buildMails(8) });
      return "sent";
    },
    warn: (message) => {
      warnings.push(message);
    },
    ...overrides,
  };

  return { deps, calls, delivered, saved, warnings };
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
    assert.equal(
      normalizeRecipients([recipient("a@example.com", "  ")])[0].name,
      null,
    );
  });

  it("collapses whitespace inside a name", () => {
    assert.equal(
      normalizeRecipients([recipient("a@example.com", " Anna\n Mária ")])[0]
        .name,
      "Anna Mária",
    );
  });

  it("rejects a malformed address before anything is sent", () => {
    assert.throws(
      () =>
        normalizeRecipients([
          recipient("a@example.com"),
          recipient("anna@gmail"),
        ]),
      /Malformed participant address: anna@gmail/,
    );
  });

  it("rejects addresses the mailer would read differently", () => {
    for (const email of [
      "anna,kovacs@gmail.com",
      "anna;kovacs@gmail.com",
      "a<b@x.hu>",
      "c@x.hu​",
      "ánna@example.com",
    ]) {
      assert.throws(
        () => normalizeRecipients([recipient(email)]),
        /Malformed participant address/,
        email,
      );
    }
  });

  it("accepts an empty list", () => {
    assert.deepEqual(normalizeRecipients([]), []);
  });
});

describe("resolveRunMode", () => {
  it("writes production rows only on a Vercel production deployment", () => {
    assert.deepEqual(resolveRunMode({ VERCEL_ENV: "production" }), {
      environment: "production",
      devMode: false,
    });
  });

  it("ignores the dev flag in production", () => {
    assert.deepEqual(
      resolveRunMode({ VERCEL_ENV: "production", DAILY_EXERCISE_DEV: "1" }),
      { environment: "production", devMode: false },
    );
  });

  it("treats local and preview runs as development", () => {
    assert.deepEqual(resolveRunMode({}), {
      environment: "development",
      devMode: false,
    });
    assert.deepEqual(resolveRunMode({ VERCEL_ENV: "preview" }), {
      environment: "development",
      devMode: false,
    });
  });

  it("enables dev mode locally with the flag", () => {
    assert.deepEqual(resolveRunMode({ DAILY_EXERCISE_DEV: "1" }), {
      environment: "development",
      devMode: true,
    });
  });

  it("refuses to guess the environment on Vercel without VERCEL_ENV", () => {
    assert.throws(() => resolveRunMode({ VERCEL: "1" }), /VERCEL_ENV/);
  });
});

describe("composeEmail", () => {
  it("puts the previous solution and the score before today's exercise", () => {
    const mail = composeEmail(previous, graded, today, "2026-10-15");
    const solutionAt = mail.text.indexOf("Megoldás: Előző megoldás");
    const scoreAt = mail.text.indexOf("Pontszámod: 8/10\nSzép munka.");
    const todayAt = mail.text.indexOf("Mai feladat szövege");

    assert.equal(mail.subject, "Napi matekfeladat – 2026. 10. 15.");
    assert.ok(
      mail.text.includes(
        "Az előző feladat\n----------------\nElőző feladat szövege",
      ),
    );
    assert.ok(solutionAt >= 0 && solutionAt < scoreAt && scoreAt < todayAt);
  });

  it("says when no solution was sent", () => {
    const mail = composeEmail(previous, { kind: "none" }, today, "2026-10-15");

    assert.ok(mail.text.includes("Erre a feladatra nem küldtél megoldást."));
  });

  it("says when the score could not be determined", () => {
    const mail = composeEmail(
      previous,
      { kind: "unknown" },
      today,
      "2026-10-15",
    );

    assert.ok(
      mail.text.includes("A pontszámot most nem sikerült megállapítani."),
    );
  });

  it("never reveals today's solution", () => {
    const mail = composeEmail(previous, graded, today, "2026-10-15");

    assert.ok(!mail.text.includes("Mai megoldás"));
  });

  it("leaves out the previous block and the score on the first day", () => {
    const mail = composeEmail(null, { kind: "none" }, today, "2026-10-15");

    assert.ok(!mail.text.includes("Az előző feladat"));
    assert.ok(!mail.text.includes("nem küldtél"));
    assert.ok(mail.text.includes("Mai feladat szövege"));
  });

  it("asks for the solution as a reply", () => {
    const mail = composeEmail(previous, graded, today, "2026-10-15");

    assert.ok(mail.text.includes("Válaszolj erre a levélre a megoldásoddal"));
  });

  it("greets the recipient by name", () => {
    const mail = composeEmail(previous, graded, today, "2026-10-15", "Anna");

    assert.ok(mail.text.startsWith("Szia Anna!\n\n"));
  });

  it("greets without a name when there is none", () => {
    const mail = composeEmail(previous, graded, today, "2026-10-15", null);

    assert.ok(mail.text.startsWith("Szia!\n\n"));
  });

  it("leaves out the score line for a new participant", () => {
    const mail = composeEmail(
      previous,
      { kind: "new" },
      today,
      "2026-10-15",
      null,
    );

    assert.ok(mail.text.includes("Megoldás: Előző megoldás"));
    assert.ok(!mail.text.includes("Pontszámod"));
    assert.ok(!mail.text.includes("nem küldtél"));
    assert.ok(!mail.text.includes("nem sikerült"));
    assert.ok(!mail.text.includes("\n\n\n"));
  });
});

describe("runDailyExercise", () => {
  it("delivers one personalised email per recipient at 9 in Budapest", async () => {
    const { deps, delivered } = fakeDeps();

    assert.equal(await runDailyExercise(deps), "sent");
    assert.deepEqual(delivered[0].record, {
      slot: "2026-10-15",
      date: "2026-10-15",
      ...today,
    });

    const mails = delivered[0].mails;

    assert.deepEqual(
      mails.map((mail) => mail.to),
      ["a@example.com", "b@example.com"],
    );
    assert.deepEqual(
      mails.map((mail) => mail.messageId),
      ["<test.8.1@napi-matek>", "<test.8.2@napi-matek>"],
    );
    assert.ok(mails[0].text.includes("Pontszámod: 8/10\nSzép munka."));
    assert.ok(
      mails[1].text.includes("Erre a feladatra nem küldtél megoldást."),
    );

    for (const mail of mails) {
      assert.equal(mail.subject, "Napi matekfeladat – 2026. 10. 15.");
      assert.ok(mail.text.includes("Megoldás: Előző megoldás"));
      assert.ok(mail.text.includes("Mai feladat szövege"));
      assert.ok(!mail.text.includes("Mai megoldás"));
    }
  });

  it("saves each new grade for the previous exercise", async () => {
    const { deps, calls, saved } = fakeDeps();

    await runDailyExercise(deps);

    assert.ok(calls.includes("grade:a@example.com"));
    assert.deepEqual(saved, [
      {
        exerciseId: 7,
        email: "a@example.com",
        grade: { score: 8, feedback: "Szép munka." },
      },
    ]);
  });

  it("reuses a stored score for the same reply", async () => {
    const { deps, calls, saved, delivered } = fakeDeps({
      getScores: async () =>
        new Map([
          [
            "a@example.com",
            {
              replyMessageId: "<reply-a@example.com>",
              score: 5,
              feedback: "Régi értékelés.",
            },
          ],
        ]),
    });

    await runDailyExercise(deps);

    assert.ok(!calls.includes("grade:a@example.com"));
    assert.deepEqual(saved, []);
    assert.ok(
      delivered[0].mails[0].text.includes("Pontszámod: 5/10\nRégi értékelés."),
    );
  });

  it("regrades when a newer reply arrived", async () => {
    const { deps, calls, saved, delivered } = fakeDeps({
      getScores: async () =>
        new Map([
          [
            "a@example.com",
            {
              replyMessageId: "<older@icloud.com>",
              score: 5,
              feedback: "Régi.",
            },
          ],
        ]),
    });

    await runDailyExercise(deps);

    assert.ok(calls.includes("grade:a@example.com"));
    assert.equal(saved.length, 1);
    assert.ok(delivered[0].mails[0].text.includes("Pontszámod: 8/10"));
  });

  it("sends without scores when reading replies fails", async () => {
    const { deps, calls, delivered, warnings } = fakeDeps({
      fetchReplies: async () => {
        throw new Error("IMAP down");
      },
    });

    assert.equal(await runDailyExercise(deps), "sent");
    assert.ok(!calls.some((call) => call.startsWith("grade:")));
    assert.deepEqual(warnings, ["[daily-exercise] reading replies failed"]);

    for (const mail of delivered[0].mails) {
      assert.ok(
        mail.text.includes("A pontszámot most nem sikerült megállapítani."),
      );
    }
  });

  it("marks only the failed grade as unknown", async () => {
    const { deps, delivered, saved, warnings } = fakeDeps({
      fetchReplies: async () =>
        new Map([
          ["a@example.com", reply("a@example.com")],
          ["b@example.com", reply("b@example.com")],
        ]),
      grade: async (_previous, answer) => {
        if (answer.from === "b@example.com") {
          throw new Error("Claude down");
        }

        return { score: 8, feedback: "Szép munka." };
      },
    });

    assert.equal(await runDailyExercise(deps), "sent");
    assert.ok(delivered[0].mails[0].text.includes("Pontszámod: 8/10"));
    assert.ok(
      delivered[0].mails[1].text.includes(
        "A pontszámot most nem sikerült megállapítani.",
      ),
    );
    assert.deepEqual(
      saved.map((item) => item.email),
      ["a@example.com"],
    );
    assert.deepEqual(warnings, [
      "[daily-exercise] grading b@example.com failed",
    ]);
  });

  it("still uses a grade whose saving failed", async () => {
    const { deps, delivered, warnings } = fakeDeps({
      saveScore: async () => {
        throw new Error("DB down");
      },
    });

    assert.equal(await runDailyExercise(deps), "sent");
    assert.ok(delivered[0].mails[0].text.includes("Pontszámod: 8/10"));
    assert.deepEqual(warnings, [
      "[daily-exercise] saving the score of a@example.com failed",
    ]);
  });

  it("regrades when loading the stored scores fails", async () => {
    const { deps, calls, saved, delivered, warnings } = fakeDeps({
      getScores: async () => {
        throw new Error("DB down");
      },
    });

    assert.equal(await runDailyExercise(deps), "sent");
    assert.ok(calls.includes("grade:a@example.com"));
    assert.equal(saved.length, 1);
    assert.ok(delivered[0].mails[0].text.includes("Pontszámod: 8/10"));
    assert.deepEqual(warnings, ["[daily-exercise] loading scores failed"]);
  });

  it("keeps a stored score when the reply has left the inbox", async () => {
    const { deps, calls, delivered } = fakeDeps({
      fetchReplies: async () => new Map(),
      getScores: async () =>
        new Map([
          [
            "a@example.com",
            {
              replyMessageId: "<reply-a@example.com>",
              score: 5,
              feedback: "Régi értékelés.",
            },
          ],
        ]),
    });

    await runDailyExercise(deps);

    assert.ok(!calls.some((call) => call.startsWith("grade:")));
    assert.ok(
      delivered[0].mails[0].text.includes("Pontszámod: 5/10\nRégi értékelés."),
    );
    assert.ok(
      delivered[0].mails[1].text.includes(
        "Erre a feladatra nem küldtél megoldást.",
      ),
    );
  });

  it("keeps stored scores when reading replies fails", async () => {
    const { deps, delivered } = fakeDeps({
      fetchReplies: async () => {
        throw new Error("IMAP down");
      },
      getScores: async () =>
        new Map([
          [
            "a@example.com",
            {
              replyMessageId: "<reply-a@example.com>",
              score: 5,
              feedback: "Régi értékelés.",
            },
          ],
        ]),
    });

    await runDailyExercise(deps);

    assert.ok(delivered[0].mails[0].text.includes("Pontszámod: 5/10"));
    assert.ok(
      delivered[0].mails[1].text.includes(
        "A pontszámot most nem sikerült megállapítani.",
      ),
    );
  });

  it("warns and sends without scores when scoring itself breaks", async () => {
    const { deps, delivered, warnings } = fakeDeps({
      // A broken dependency makes scoring reject despite its own guards.
      getScores: async () => undefined as unknown as Map<string, StoredScore>,
    });

    assert.equal(await runDailyExercise(deps), "sent");
    assert.deepEqual(warnings, ["[daily-exercise] scoring failed"]);

    for (const mail of delivered[0].mails) {
      assert.ok(
        mail.text.includes("A pontszámot most nem sikerült megállapítani."),
      );
    }
  });

  it("matches recipients to replies case-insensitively", async () => {
    const { deps, delivered, saved } = fakeDeps({
      recipients: [recipient("A@Example.com")],
    });

    await runDailyExercise(deps);

    assert.equal(delivered[0].mails[0].to, "A@Example.com");
    assert.ok(delivered[0].mails[0].text.includes("Pontszámod: 8/10"));
    assert.equal(saved[0].email, "a@example.com");
  });

  it("sends the first email without a previous block and reads no replies", async () => {
    const { deps, calls, delivered } = fakeDeps({
      getPrevious: async () => null,
    });

    assert.equal(await runDailyExercise(deps), "sent");
    assert.ok(!calls.includes("fetchReplies"));
    assert.ok(!delivered[0].mails[0].text.includes("Az előző feladat"));
    assert.ok(delivered[0].mails[0].text.includes("Mai feladat szövege"));
  });

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
      recipients: [
        recipient("c@example.com", null, new Date("2026-10-14T12:00:00Z")),
      ],
      fetchReplies: async () =>
        new Map([["c@example.com", reply("c@example.com")]]),
    });

    await runDailyExercise(deps);

    assert.ok(delivered[0].mails[0].text.includes("Pontszámod: 8/10"));
  });

  it("keeps a stored score for a new participant", async () => {
    const { deps, delivered } = fakeDeps({
      recipients: [
        recipient("c@example.com", null, new Date("2026-10-14T12:00:00Z")),
      ],
      fetchReplies: async () => new Map(),
      getScores: async () =>
        new Map([
          [
            "c@example.com",
            {
              replyMessageId: "<reply-c@example.com>",
              score: 5,
              feedback: "Régi értékelés.",
            },
          ],
        ]),
    });

    await runDailyExercise(deps);

    assert.ok(delivered[0].mails[0].text.includes("Pontszámod: 5/10"));
  });

  it("does not report an unreadable inbox to a new participant", async () => {
    const { deps, delivered } = fakeDeps({
      recipients: [
        recipient("c@example.com", null, new Date("2026-10-14T12:00:00Z")),
      ],
      fetchReplies: async () => {
        throw new Error("IMAP down");
      },
    });

    await runDailyExercise(deps);

    const text = delivered[0].mails[0].text;

    assert.ok(text.includes("Megoldás: Előző megoldás"));
    assert.ok(!text.includes("nem sikerült"));
    assert.ok(!text.includes("nem küldtél"));
  });

  it("checks already-sent before the empty list", async () => {
    const { deps } = fakeDeps({
      recipients: [],
      getPrevious: async () => ({ ...previous, date: "2026-10-15" }),
    });

    assert.equal(await runDailyExercise(deps), "already-sent");
  });

  it("greets recipients by name", async () => {
    const { deps, delivered } = fakeDeps({
      recipients: [recipient("a@example.com", "Anna")],
    });

    await runDailyExercise(deps);

    assert.ok(delivered[0].mails[0].text.startsWith("Szia Anna!\n\n"));
  });

  for (const [now, expected] of [
    ["2026-12-01T07:30:00Z", "skipped-hour"], // 08:30 in Budapest (CET)
    ["2026-12-01T08:59:00Z", "sent"], // 09:59 (CET)
    ["2026-07-01T07:59:00Z", "sent"], // 09:59 (CEST)
    ["2026-07-01T08:00:00Z", "skipped-hour"], // 10:00 in Budapest (CEST)
  ] as const) {
    it(`returns ${expected} at ${now}`, async () => {
      const { deps, calls } = fakeDeps({ now: new Date(now) });

      assert.equal(await runDailyExercise(deps), expected);

      if (expected === "skipped-hour") {
        assert.deepEqual(calls, []);
      } else {
        assert.ok(calls.includes("deliver"));
      }
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

  it("finishes saving grades before a failed generation rejects", async () => {
    const { deps, saved } = fakeDeps({
      generate: async () => {
        throw new Error("Claude down");
      },
      grade: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { score: 8, feedback: "Szép munka." };
      },
    });

    await assert.rejects(runDailyExercise(deps), /Claude down/);
    assert.equal(saved.length, 1);
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
    assert.ok(delivered[0].mails[0].text.includes("Megoldás: Előző megoldás"));
  });
});
