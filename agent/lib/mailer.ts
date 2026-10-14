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
  const transport = createTransport({
    service: "gmail",
    auth: { user: credentials.user, pass: credentials.appPassword },
  });

  // Recipients go in BCC so they do not see each other's addresses.
  await transport.sendMail({
    from: credentials.user,
    to: credentials.user,
    bcc: mail.bcc,
    subject: mail.subject,
    text: mail.text,
  });
}
