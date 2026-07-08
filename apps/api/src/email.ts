import { Resend } from "resend";
import { env } from "./env.ts";

const resendFromEmail = "Tab <tab@cueva.io>";

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
  const { data, error } = await resend.emails.send({
    from: resendFromEmail,
    to,
    subject,
    text,
    html,
  });

  if (error) {
    throw new Error(`Resend email failed: ${error.message}`);
  }

  console.log(
    `Sent email to ${to} from ${resendFromEmail}, id: ${data?.id ?? "unknown"}`,
  );
}
