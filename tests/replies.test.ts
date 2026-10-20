import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildMessageId,
  parseMessageIds,
  referencesOwnMessage,
  selectImages,
  selectReplies,
  type InboundReply,
} from "../agent/lib/replies.ts";

function reply(overrides: Partial<InboundReply> = {}): InboundReply {
  return {
    from: "a@example.com",
    messageId: "<r1@icloud.com>",
    references: ["<production.7.abc123@napi-matek>"],
    receivedAt: new Date("2026-10-14T18:00:00Z"),
    text: "12 méter",
    images: [],
    skippedImages: 0,
    ...overrides,
  };
}

const target = {
  environment: "production" as const,
  exerciseId: 7,
  recipients: ["a@example.com", "b@example.com"],
};

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

describe("selectReplies", () => {
  it("keeps the latest reply of each sender", () => {
    const early = reply({
      messageId: "<r1@x>",
      receivedAt: new Date("2026-10-14T10:00:00Z"),
    });
    const late = reply({
      messageId: "<r2@x>",
      receivedAt: new Date("2026-10-14T20:00:00Z"),
    });
    const other = reply({ from: "b@example.com", messageId: "<r3@x>" });

    const selected = selectReplies([late, other, early], target);

    assert.equal(selected.size, 2);
    assert.equal(selected.get("a@example.com"), late);
    assert.equal(selected.get("b@example.com"), other);
  });

  it("accepts only recipients, ignoring letter case in the list", () => {
    const selected = selectReplies(
      [
        reply({ from: "a@example.com" }),
        reply({ from: "stranger@example.com" }),
      ],
      { ...target, recipients: ["A@Example.com"] },
    );

    assert.deepEqual([...selected.keys()], ["a@example.com"]);
  });

  it("ignores replies to another exercise", () => {
    const selected = selectReplies(
      [reply({ references: ["<production.6.abc@napi-matek>"] })],
      target,
    );

    assert.equal(selected.size, 0);
  });

  it("ignores replies to the other environment", () => {
    const selected = selectReplies(
      [reply({ references: ["<development.7.abc@napi-matek>"] })],
      target,
    );

    assert.equal(selected.size, 0);
  });
});

describe("selectImages", () => {
  const image = (contentType: string, bytes = 10) => ({
    contentType,
    content: Buffer.alloc(bytes, 1),
  });

  it("keeps supported images as base64", () => {
    const { images, skipped } = selectImages([
      image("image/jpeg", 3),
      image("image/PNG"),
    ]);

    assert.deepEqual(
      images.map((item) => item.mediaType),
      ["image/jpeg", "image/png"],
    );
    assert.equal(images[0].base64, Buffer.alloc(3, 1).toString("base64"));
    assert.equal(skipped, 0);
  });

  it("skips unsupported, too large and surplus images", () => {
    const { images, skipped } = selectImages([
      image("image/heic"),
      image("image/jpeg", 5 * 1024 * 1024 + 1),
      image("image/png"),
      image("image/gif"),
      image("image/webp"),
      image("image/jpeg"),
    ]);

    assert.deepEqual(
      images.map((item) => item.mediaType),
      ["image/png", "image/gif", "image/webp"],
    );
    assert.equal(skipped, 3);
  });

  it("ignores attachments that are not images", () => {
    const { images, skipped } = selectImages([image("application/pdf")]);

    assert.deepEqual(images, []);
    assert.equal(skipped, 0);
  });
});
