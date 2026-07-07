import { env } from "./env.ts";

const resendFromEmail = "Tabb <tabb@cueva.io>";

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

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: resendFromEmail,
      to,
      subject,
      text,
      html,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend email failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { id?: string } | null;
  console.log(
    `Sent email to ${to} from ${resendFromEmail}, id: ${data?.id ?? "unknown"}`,
  );
}
