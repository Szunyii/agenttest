import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

import type { MailCredentials } from "./mailer";
import {
  answersExercise,
  isAutoReply,
  selectImages,
  type InboundReply,
  type ReplyTarget,
} from "./replies";

// Bounds the whole read, logout included, so a stalled IMAP server cannot eat
// the job's budget.
const readTimeoutMs = 30_000;
const dayMs = 24 * 60 * 60 * 1000;

// Reads the newest reply of each recipient to our emails about the target
// exercise, from mail received since about `since`. The mailbox is opened
// read-only, so nothing is marked as read or otherwise changed.
export async function readReplies(
  credentials: MailCredentials,
  since: Date,
  target: ReplyTarget,
): Promise<InboundReply[]> {
  try {
    return await readInbox(credentials, since, target);
  } catch (error) {
    throw describeImapError(error);
  }
}

async function readInbox(
  credentials: MailCredentials,
  since: Date,
  target: ReplyTarget,
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
  // Without a listener, a socket error after connecting would crash the
  // process. imapflow closes the connection itself and the pending command
  // rejects, which is what we report.
  client.on("error", () => {});
  let timedOut = false;
  // Closing the connection rejects whatever command is pending.
  const timer = setTimeout(() => {
    timedOut = true;
    client.close();
  }, readTimeoutMs);

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });

    try {
      // IMAP SINCE compares whole days in the server's time zone, so search
      // from a day earlier; the exercise id in the references does the exact
      // matching.
      const messages = await client.fetchAll(
        { since: new Date(since.getTime() - dayMs) },
        {
          uid: true,
          envelope: true,
          internalDate: true,
          headers: ["references", "auto-submitted"],
        },
      );
      // Download only the newest human reply of each recipient to this
      // exercise, so earlier attempts cannot eat the time budget;
      // selectReplies makes the same choice from the parsed mail.
      const recipients = new Set(
        target.recipients.map((recipient) => recipient.toLowerCase()),
      );
      const newest = new Map<string, { uid: number; receivedAt: Date }>();

      for (const message of messages) {
        const from = (message.envelope?.from?.[0]?.address ?? "").toLowerCase();
        const receivedAt = new Date(message.internalDate ?? 0);
        const headers = message.headers?.toString("utf8") ?? "";
        const references = [message.envelope?.inReplyTo ?? "", headers];

        if (
          !recipients.has(from) ||
          isAutoReply(headers) ||
          !answersExercise(references, target)
        ) {
          continue;
        }

        const current = newest.get(from);

        if (!current || receivedAt >= current.receivedAt) {
          newest.set(from, { uid: message.uid, receivedAt });
        }
      }

      const replies: InboundReply[] = [];

      for (const { uid, receivedAt } of newest.values()) {
        const full = await client.fetchOne(
          String(uid),
          { source: true },
          { uid: true },
        );

        // `false` means the message was deleted meanwhile; a lost connection
        // is caught below.
        if (full && full.source) {
          replies.push(await parseReply(full.source, receivedAt, uid));
        }
      }

      // Once the connection is closed, imapflow returns empty results instead
      // of failing; a cut-short read must not look like "no replies".
      if (timedOut || !client.usable) {
        throw new Error("connection lost");
      }

      return replies;
    } finally {
      lock.release();
    }
  } catch (error) {
    // A timeout usually surfaces as the pending command's lost connection.
    throw timedOut ? new Error("read timed out", { cause: error }) : error;
  } finally {
    await client.logout().catch(() => client.close());
    clearTimeout(timer);
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

// imapflow keeps the useful part (e.g. AUTHENTICATIONFAILED) outside `message`,
// and the job logs only the message.
function describeImapError(error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error(`IMAP error: ${String(error)}`);
  }

  const details = error as Error & {
    code?: string;
    serverResponseCode?: string;
    responseText?: string;
  };
  const code = [details.code, details.serverResponseCode]
    .filter(Boolean)
    .join(" ");

  return new Error(
    `IMAP ${code ? `${code}: ` : ""}${details.responseText ?? error.message}`,
    { cause: error },
  );
}
