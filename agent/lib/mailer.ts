import { createTransport } from "nodemailer";

import type { OutgoingMail } from "./daily-exercise";

export interface MailCredentials {
  user: string;
  appPassword: string;
}

export async function sendMails(
  credentials: MailCredentials,
  mails: OutgoingMail[],
  signal: AbortSignal,
): Promise<void> {
  // One pooled connection carries all of today's emails (see the budget in
  // exercise-repository.ts). Short timeouts turn a hung SMTP connection into a
  // logged error instead of the platform silently killing the function.
  const transport = createTransport({
    service: "gmail",
    pool: true,
    maxConnections: 1,
    auth: { user: credentials.user, pass: credentials.appPassword },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    // Per DNS attempt: Node's resolver retries a few times on its own.
    dnsTimeout: 3_000,
    socketTimeout: 20_000,
  });

  try {
    for (const mail of mails) {
      // Past the deadline the delivery transaction is about to roll back, so
      // stop rather than send emails for an exercise that won't be saved.
      signal.throwIfAborted();

      // Our own Message-ID lets the next run match the replies to this email.
      // With one recipient per email, a refused address makes this throw.
      await transport.sendMail({
        from: credentials.user,
        to: mail.to,
        messageId: mail.messageId,
        subject: mail.subject,
        text: mail.text,
      });
    }
  } finally {
    transport.close();
  }
}
