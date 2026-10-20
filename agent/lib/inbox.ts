import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

import type { MailCredentials } from "./mailer";
import {
  referencesOwnMessage,
  selectImages,
  type InboundReply,
} from "./replies";

// Bounds the whole read so a stalled IMAP server cannot eat the job's budget.
const readTimeoutMs = 30_000;
const dayMs = 24 * 60 * 60 * 1000;

// Reads the replies to our emails that arrived since `since`. The mailbox is
// opened read-only, so nothing is marked as read or otherwise changed.
export async function readReplies(
  credentials: MailCredentials,
  since: Date,
): Promise<InboundReply[]> {
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: credentials.user, pass: credentials.appPassword },
    logger: false,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: readTimeoutMs,
  });
  // Closing the connection rejects whatever command is pending.
  const timer = setTimeout(() => client.close(), readTimeoutMs);

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });

    try {
      // IMAP SINCE compares whole days in the server's time zone, so search
      // from a day earlier and apply the exact cut-off here.
      const messages = await client.fetchAll(
        { since: new Date(since.getTime() - dayMs) },
        {
          uid: true,
          envelope: true,
          internalDate: true,
          headers: ["references"],
        },
      );
      const replies: InboundReply[] = [];

      for (const message of messages) {
        const receivedAt = new Date(message.internalDate ?? 0);
        const references = [
          message.envelope?.inReplyTo ?? "",
          message.headers?.toString("utf8") ?? "",
        ];

        // Download only the replies to our own emails.
        if (receivedAt < since || !referencesOwnMessage(references)) {
          continue;
        }

        const full = await client.fetchOne(
          String(message.uid),
          { source: true },
          { uid: true },
        );

        if (full && full.source) {
          replies.push(await parseReply(full.source, receivedAt, message.uid));
        }
      }

      return replies;
    } finally {
      lock.release();
    }
  } finally {
    clearTimeout(timer);
    await client.logout().catch(() => client.close());
  }
}

async function parseReply(
  source: Buffer,
  receivedAt: Date,
  uid: number,
): Promise<InboundReply> {
  const mail = await simpleParser(source);
  const references = Array.isArray(mail.references)
    ? mail.references
    : mail.references
      ? [mail.references]
      : [];
  const { images, skipped } = selectImages(mail.attachments);

  return {
    from: (mail.from?.value[0]?.address ?? "").toLowerCase(),
    // Without a Message-ID the uid still lets a rerun spot a graded reply.
    messageId: mail.messageId ?? `<uid-${uid}@inbox>`,
    references: [mail.inReplyTo ?? "", ...references],
    receivedAt,
    text: mail.text ?? "",
    images,
    skippedImages: skipped,
  };
}
