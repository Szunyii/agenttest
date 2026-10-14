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
  it("sends at 9 in Budapest and saves only afterwards", async () => {
    const { deps, calls, sent, saved } = fakeDeps();

    assert.equal(await runDailyExercise(deps), "sent");
    assert.deepEqual(calls, ["generate", "send", "save"]);
    assert.deepEqual(sent[0].bcc, ["a@example.com", "b@example.com"]);
    assert.deepEqual(saved, [{ date: "2026-10-15", ...today }]);
  });

  for (const [now, expected, expectedCalls] of [
    ["2026-12-01T07:30:00Z", "skipped-hour", []], // 08:30 in Budapest (CET)
    ["2026-12-01T08:59:00Z", "sent", ["generate", "send", "save"]], // 09:59 (CET)
    ["2026-07-01T07:59:00Z", "sent", ["generate", "send", "save"]], // 09:59 (CEST)
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

  it("neither sends nor saves when generating fails", async () => {
    const { deps, calls } = fakeDeps({
      generate: async () => {
        throw new Error("Claude down");
      },
    });

    await assert.rejects(runDailyExercise(deps), /Claude down/);
    assert.deepEqual(calls, []);
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
