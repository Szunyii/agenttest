import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  answersExercise,
  buildMessageId,
  isAutoReply,
  parseMessageIds,
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
    skippedImages: { unsupported: 0, tooLarge: 0, surplus: 0 },
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

describe("answersExercise", () => {
  it("matches only our ids for the given environment and exercise", () => {
    const exercise = { environment: "production" as const, exerciseId: 3 };

    assert.equal(
      answersExercise(
        ["References: <a@x> <production.3.f0@napi-matek>"],
        exercise,
      ),
      true,
    );
    assert.equal(
      answersExercise(["<development.3.f0@napi-matek>"], exercise),
      false,
    );
    assert.equal(
      answersExercise(["<production.2.f0@napi-matek>"], exercise),
      false,
    );
    assert.equal(answersExercise(["<a@x>", ""], exercise), false);
  });
});

describe("isAutoReply", () => {
  it("treats every Auto-Submitted value but no as automatic", () => {
    assert.equal(
      isAutoReply("References: <a@x>\r\nAuto-Submitted: auto-replied\r\n"),
      true,
    );
    assert.equal(isAutoReply("auto-submitted: Auto-Generated; x=y\r\n"), true);
    assert.equal(isAutoReply("Auto-Submitted: no\r\n"), false);
    assert.equal(isAutoReply("References: <a@x>\r\n\r\n"), false);
  });
});

describe("selectReplies", () => {
  it("keeps the latest reply of each sender, whatever the order", () => {
    const early = reply({
      messageId: "<r1@x>",
      receivedAt: new Date("2026-10-14T10:00:00Z"),
    });
    const late = reply({
      messageId: "<r2@x>",
      receivedAt: new Date("2026-10-14T20:00:00Z"),
    });
    const other = reply({ from: "b@example.com", messageId: "<r3@x>" });

    for (const replies of [
      [early, late, other],
      [late, other, early],
    ]) {
      const selected = selectReplies(replies, target);

      assert.equal(selected.size, 2);
      assert.equal(selected.get("a@example.com"), late);
      assert.equal(selected.get("b@example.com"), other);
    }
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

  it("accepts a reply that also references an older exercise", () => {
    const selected = selectReplies(
      [
        reply({
          references: [
            "<production.6.abc@napi-matek>",
            "<production.7.abc@napi-matek>",
          ],
        }),
      ],
      target,
    );

    assert.equal(selected.size, 1);
  });

  it("matches and keys senders in lower case", () => {
    const selected = selectReplies([reply({ from: "A@Example.COM" })], target);

    assert.deepEqual([...selected.keys()], ["a@example.com"]);
  });
});

describe("selectImages", () => {
  const image = (contentType: string, bytes = 10) => ({
    contentType,
    content: Buffer.alloc(bytes, 1),
  });
  const none = { unsupported: 0, tooLarge: 0, surplus: 0 };

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
    assert.deepEqual(skipped, none);
  });

  it("sorts out unsupported, too large and surplus images", () => {
    const { images, skipped } = selectImages([
      image("image/heic"),
      image("image/jpeg", 7_864_323), // just over 10 MB as base64
      image("image/png"),
      image("image/gif"),
      image("image/webp"),
      image("image/jpeg"),
    ]);

    assert.deepEqual(
      images.map((item) => item.mediaType),
      ["image/png", "image/gif", "image/webp"],
    );
    assert.deepEqual(skipped, { unsupported: 1, tooLarge: 1, surplus: 1 });
  });

  it("accepts an image right at the per-image limit", () => {
    const { images, skipped } = selectImages([
      image("image/jpeg", 7_864_320), // exactly 10 MB as base64
    ]);

    assert.equal(images.length, 1);
    assert.deepEqual(skipped, none);
  });

  it("caps the total size of the images", () => {
    const nineMegabytes = 7_077_888; // 9 MB as base64
    const { images, skipped } = selectImages([
      image("image/jpeg", nineMegabytes),
      image("image/jpeg", nineMegabytes),
      image("image/jpeg", nineMegabytes),
    ]);

    assert.equal(images.length, 2);
    assert.deepEqual(skipped, { unsupported: 0, tooLarge: 1, surplus: 0 });
  });

  it("ignores attachments that are not images", () => {
    const { images, skipped } = selectImages([image("application/pdf")]);

    assert.deepEqual(images, []);
    assert.deepEqual(skipped, none);
  });

  // Just the header bytes each format keeps its size in.
  const png = (width: number, height: number) => {
    const bytes = Buffer.alloc(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    bytes.write("IHDR", 12, "latin1");
    bytes.writeUInt32BE(width, 16);
    bytes.writeUInt32BE(height, 20);
    return bytes;
  };
  const jpeg = (width: number, height: number) => {
    // SOI, an APP0 segment to skip, then the SOF0 frame header.
    const bytes = Buffer.alloc(31);
    bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    bytes.set([0xff, 0xc0, 0x00, 0x11, 0x08], 20);
    bytes.writeUInt16BE(height, 25);
    bytes.writeUInt16BE(width, 27);
    return bytes;
  };
  const gif = (width: number, height: number) => {
    const bytes = Buffer.alloc(10);
    bytes.write("GIF89a", 0, "latin1");
    bytes.writeUInt16LE(width, 6);
    bytes.writeUInt16LE(height, 8);
    return bytes;
  };

  it("puts attached files before images embedded in the body", () => {
    const embedded = (width: number) => ({
      contentType: "image/png",
      content: png(width, 100),
      related: true,
    });
    const { images, skipped } = selectImages([
      embedded(417),
      embedded(418),
      embedded(419),
      { contentType: "image/jpeg", content: jpeg(4032, 3024) },
    ]);

    assert.deepEqual(
      images.map((item) => item.mediaType),
      ["image/jpeg", "image/png", "image/png"],
    );
    assert.equal(images[1].base64, png(417, 100).toString("base64"));
    assert.deepEqual(skipped, { unsupported: 0, tooLarge: 0, surplus: 1 });
  });

  it("leaves out images over the API's 8000 pixels", () => {
    const { images, skipped } = selectImages([
      { contentType: "image/png", content: png(8000, 8000) },
      { contentType: "image/png", content: png(8001, 10) },
      { contentType: "image/jpeg", content: jpeg(100, 9000) },
      { contentType: "image/gif", content: gif(8001, 1) },
      // An embedded one is a signature's banner, not the student's photo.
      { contentType: "image/png", content: png(8407, 308), related: true },
    ]);

    assert.equal(images.length, 1);
    assert.deepEqual(skipped, { unsupported: 0, tooLarge: 3, surplus: 0 });
  });
});
