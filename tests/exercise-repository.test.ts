import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createExerciseRepository } from "../agent/lib/exercise-repository.ts";

describe("getRecipients", () => {
  it("loads the environment's active participants in id order", async () => {
    const activeSince = new Date("2026-10-20T08:00:00Z");
    let query: unknown;
    const prisma = {
      participant: {
        findMany: async (args: unknown) => {
          query = args;

          return [
            {
              id: 1,
              environment: "production",
              email: "anna@example.com",
              name: "Anna",
              active: true,
              activeSince,
              createdAt: new Date("2026-10-01T00:00:00Z"),
            },
          ];
        },
      },
    };
    const repository = createExerciseRepository(
      prisma as never,
      "production",
      async () => {},
    );

    assert.deepEqual(await repository.getRecipients(), [
      { email: "anna@example.com", name: "Anna", since: activeSince },
    ]);
    // Dropping either filter would email the wrong people.
    assert.deepEqual(query, {
      where: { environment: "production", active: true },
      orderBy: { id: "asc" },
    });
  });
});
