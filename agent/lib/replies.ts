import { randomBytes } from "node:crypto";

import type { Environment } from "./daily-exercise";

export interface ReplyImage {
  mediaType: string;
  base64: string;
}

// Why image attachments were left out of the grading request.
export interface ImageSkips {
  // Not JPEG, PNG, GIF or WebP, e.g. HEIC.
  unsupported: number;
  tooLarge: number;
  // Beyond the first few images.
  surplus: number;
}

export interface InboundReply {
  // The sender's address, lowercased.
  from: string;
  messageId: string;
  // Every value of In-Reply-To and References.
  references: string[];
  receivedAt: Date;
  text: string;
  images: ReplyImage[];
  // Image attachments left out, by reason.
  skippedImages: ImageSkips;
}

export interface ExerciseRef {
  environment: Environment;
  exerciseId: number;
}

export interface ReplyTarget extends ExerciseRef {
  recipients: string[];
}

// Every email we send carries one of these ids, so a reply can be traced back
// to its environment and exercise through In-Reply-To or References.
const ownMessageId =
  /^<(production|development)\.(\d+)\.[0-9a-z]+@napi-matek>$/;

export function buildMessageId(
  environment: Environment,
  exerciseId: number,
  random = randomBytes(6).toString("hex"),
): string {
  return `<${environment}.${exerciseId}.${random}@napi-matek>`;
}

// Our ids in the given header values, in order. A reply usually repeats the
// same id in In-Reply-To and References, so the result may contain duplicates.
export function parseMessageIds(
  values: string[],
): Array<{ environment: Environment; exerciseId: number }> {
  return values
    .flatMap((value) => value.match(/<[^<>\s]+>/g) ?? [])
    .flatMap((id) => {
      const match = ownMessageId.exec(id);

      return match
        ? [
            {
              environment: match[1] as Environment,
              exerciseId: Number(match[2]),
            },
          ]
        : [];
    });
}

// Whether the header values reference one of our emails about this exercise.
export function answersExercise(
  references: string[],
  exercise: ExerciseRef,
): boolean {
  return parseMessageIds(references).some(
    (id) =>
      id.environment === exercise.environment &&
      id.exerciseId === exercise.exerciseId,
  );
}

// RFC 3834: any Auto-Submitted value but "no" means a machine sent it, such as
// an out-of-office answer, which must not be graded as an empty solution.
export function isAutoReply(headerText: string): boolean {
  const match = /^auto-submitted:\s*([^\s;]+)/im.exec(headerText);

  return match !== null && match[1].toLowerCase() !== "no";
}

// The latest reply from each recipient that answers the target exercise,
// keyed by the lowercased sender address.
export function selectReplies(
  replies: InboundReply[],
  target: ReplyTarget,
): Map<string, InboundReply> {
  const recipients = new Set(
    target.recipients.map((recipient) => recipient.toLowerCase()),
  );
  const latest = new Map<string, InboundReply>();

  for (const reply of replies) {
    const from = reply.from.toLowerCase();
    const answersTarget = answersExercise(reply.references, target);

    if (!recipients.has(from) || !answersTarget) {
      continue;
    }

    const current = latest.get(from);

    // On equal times the message read later from the mailbox wins.
    if (!current || reply.receivedAt >= current.receivedAt) {
      latest.set(from, reply);
    }
  }

  return latest;
}

// Claude reads these formats. The API takes images up to 10 MB each and
// requests up to 32 MB, both measured as base64; if it still refuses an image,
// the grader retries without images.
const supportedImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);
const maxImages = 3;
const maxImageBase64Chars = 10 * 1024 * 1024;
const maxTotalBase64Chars = 24 * 1024 * 1024;

// The image attachments Claude can read, in order, and why the others were
// left out; attachments that are not images are ignored.
export function selectImages(
  attachments: Array<{ contentType: string; content: Uint8Array }>,
): { images: ReplyImage[]; skipped: ImageSkips } {
  const images: ReplyImage[] = [];
  const skipped: ImageSkips = { unsupported: 0, tooLarge: 0, surplus: 0 };
  let totalChars = 0;

  for (const attachment of attachments) {
    const mediaType = attachment.contentType.toLowerCase();

    if (!mediaType.startsWith("image/")) {
      continue;
    }

    if (!supportedImageTypes.has(mediaType)) {
      skipped.unsupported += 1;
      continue;
    }

    if (images.length === maxImages) {
      skipped.surplus += 1;
      continue;
    }

    // The base64 size, without encoding an image we may not keep.
    const base64Chars = Math.ceil(attachment.content.length / 3) * 4;

    if (
      base64Chars > maxImageBase64Chars ||
      totalChars + base64Chars > maxTotalBase64Chars
    ) {
      skipped.tooLarge += 1;
      continue;
    }

    images.push({
      mediaType,
      base64: Buffer.from(attachment.content).toString("base64"),
    });
    totalChars += base64Chars;
  }

  return { images, skipped };
}
