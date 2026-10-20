import { createTransport } from "nodemailer";

import type { OutgoingMail } from "./daily-exercise";

export interface MailCredentials {
  user: string;
  appPassword: string;
}

export async function sendMails(
  credentials: MailCredentials,
  mails: OutgoingMail[],
): Promise<void> {
  // One pooled connection carries all of today's emails, so the worst case
  // stays inside the delivery transaction's timeout. Short timeouts turn a hung
  // SMTP connection into a logged error instead of the platform silently
  // killing the function.
  const transport = createTransport({
    service: "gmail",
    pool: true,
    maxConnections: 1,
    auth: { user: credentials.user, pass: credentials.appPassword },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    dnsTimeout: 10_000,
    socketTimeout: 20_000,
  });

  try {
    for (const mail of mails) {
      // Our own Message-ID lets the next run match the replies to this email.
      const info = await transport.sendMail({
        from: credentials.user,
        to: mail.to,
        messageId: mail.messageId,
        subject: mail.subject,
        text: mail.text,
      });

      // Gmail accepts the mail as long as the address is well-formed.
      if (info.rejected.length > 0) {
        console.warn("[mailer] rejected recipients:", info.rejected);
      }
    }
  } finally {
    transport.close();
  }
}
