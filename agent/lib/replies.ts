import { randomBytes } from "node:crypto";

import type { Environment } from "./daily-exercise";

export interface ReplyImage {
  mediaType: string;
  base64: string;
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
  // Image attachments left out: unsupported format, too large or over the limit.
  skippedImages: number;
}

export interface ReplyTarget {
  environment: Environment;
  exerciseId: number;
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

export function referencesOwnMessage(values: string[]): boolean {
  return parseMessageIds(values).length > 0;
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
    const answersTarget = parseMessageIds(reply.references).some(
      (id) =>
        id.environment === target.environment &&
        id.exerciseId === target.exerciseId,
    );

    if (!recipients.has(reply.from) || !answersTarget) {
      continue;
    }

    const current = latest.get(reply.from);

    if (!current || reply.receivedAt > current.receivedAt) {
      latest.set(reply.from, reply);
    }
  }

  return latest;
}

// Claude reads these formats, and the API rejects images over 5 MB.
const supportedImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);
const maxImages = 3;
const maxImageBytes = 5 * 1024 * 1024;

export function selectImages(
  attachments: Array<{ contentType: string; content: Uint8Array }>,
): { images: ReplyImage[]; skipped: number } {
  const candidates = attachments.filter((attachment) =>
    attachment.contentType.toLowerCase().startsWith("image/"),
  );
  const images: ReplyImage[] = [];

  for (const attachment of candidates) {
    const mediaType = attachment.contentType.toLowerCase();

    if (
      images.length < maxImages &&
      supportedImageTypes.has(mediaType) &&
      attachment.content.length <= maxImageBytes
    ) {
      images.push({
        mediaType,
        base64: Buffer.from(attachment.content).toString("base64"),
      });
    }
  }

  return { images, skipped: candidates.length - images.length };
}
