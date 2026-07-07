import { Resend } from "resend";
import { env } from "./env.ts";

type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export async function sendEmail({
  to,
  subject,
  text,
  html,
}: SendEmailInput): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.warn(`Skipping email to ${to}: RESEND_API_KEY is not configured.`);
    return;
  }

  const resend = new Resend(env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: env.RESEND_FROM_EMAIL,
    to,
    subject,
    text,
    html,
  });

  if (error) {
    throw new Error(`Resend email failed: ${error.message}`);
  }
}
