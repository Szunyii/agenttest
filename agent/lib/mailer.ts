import { createTransport } from "nodemailer";

import type { OutgoingMail } from "./daily-exercise";

export interface MailCredentials {
  user: string;
  appPassword: string;
}

export async function sendMail(
  credentials: MailCredentials,
  mail: OutgoingMail,
): Promise<void> {
  // Short timeouts turn a hung SMTP connection into a logged error instead of
  // the platform silently killing the function.
  const transport = createTransport({
    service: "gmail",
    auth: { user: credentials.user, pass: credentials.appPassword },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    dnsTimeout: 10_000,
    socketTimeout: 30_000,
  });

  // Recipients go in BCC so they do not see each other's addresses.
  const info = await transport.sendMail({
    from: credentials.user,
    to: credentials.user,
    bcc: mail.bcc,
    subject: mail.subject,
    text: mail.text,
  });

  // Gmail accepts the mail as long as one recipient is valid, so report the rest.
  if (info.rejected.length > 0) {
    console.warn("[mailer] rejected recipients:", info.rejected);
  }
}
