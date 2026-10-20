import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildMessageId,
  parseMessageIds,
  referencesOwnMessage,
} from "../agent/lib/replies.ts";

describe("buildMessageId", () => {
  it("encodes the environment and the exercise id", () => {
    assert.equal(
      buildMessageId("production", 42, "abc123"),
      "<production.42.abc123@napi-matek>",
    );
  });

  it("makes every id unique and parseable", () => {
    const first = buildMessageId("development", 7);
    const second = buildMessageId("development", 7);

    assert.notEqual(first, second);
    assert.deepEqual(parseMessageIds([first]), [
      { environment: "development", exerciseId: 7 },
    ]);
  });
});

describe("parseMessageIds", () => {
  it("finds our ids among foreign ones in header values", () => {
    assert.deepEqual(
      parseMessageIds([
        "<CAF123@mail.gmail.com> <development.7.ab12@napi-matek>",
        "<production.9.ff@napi-matek>",
      ]),
      [
        { environment: "development", exerciseId: 7 },
        { environment: "production", exerciseId: 9 },
      ],
    );
  });

  it("ignores malformed and foreign ids", () => {
    assert.deepEqual(
      parseMessageIds([
        "<staging.7.ab@napi-matek> <development.x.ab@napi-matek>",
        "<development.7.ab@example.com> development.7.ab@napi-matek",
      ]),
      [],
    );
  });

  it("reads folded header lines", () => {
    assert.deepEqual(
      parseMessageIds([
        "References: <a@x>\r\n\t<production.3.f0@napi-matek>\r\n",
      ]),
      [{ environment: "production", exerciseId: 3 }],
    );
  });
});

describe("referencesOwnMessage", () => {
  it("tells whether a message answers one of our emails", () => {
    assert.equal(
      referencesOwnMessage(["References: <a@x> <production.3.f0@napi-matek>"]),
      true,
    );
    assert.equal(referencesOwnMessage(["<a@x>", ""]), false);
  });
});
