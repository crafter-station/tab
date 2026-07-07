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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function linkEmailHtml(message: string, url: string): string {
  const safeMessage = escapeHtml(message);
  const safeUrl = escapeHtml(url);

  return `<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.5; color: #141414;">
    <p>${safeMessage}</p>
    <p><a href="${safeUrl}" style="display: inline-block; padding: 10px 14px; border-radius: 8px; background: #141414; color: #ffffff; text-decoration: none;">Continue</a></p>
    <p style="color: #666666; font-size: 14px;">If the button does not work, copy and paste this link into your browser:<br>${safeUrl}</p>
  </body>
</html>`;
}
