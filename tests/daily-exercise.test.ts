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
