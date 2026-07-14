import { z } from "zod";

export function safeNextPath(value: string | null | undefined): string | undefined {
  if (!value?.startsWith("/") || value.startsWith("//")) return undefined;
  try {
    const url = new URL(value, "http://localhost");
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return undefined;
  }
}

const optionalText = z.string().trim().max(2_000).optional().catch(undefined);

export const AuthSearchSchema = z.object({
  device_id: optionalText,
  callback: optionalText,
  next: optionalText.transform(safeNextPath),
  error: z.enum(["invalid_form", "invalid_credentials", "email_unverified", "signup_failed", "device_failed"]).optional().catch(undefined),
  status: z.enum(["verify_email", "reset_sent"]).optional().catch(undefined),
});

export const ResetSearchSchema = z.object({
  token: optionalText,
  error: z.enum(["INVALID_TOKEN", "reset_failed", "invalid_form"]).optional().catch(undefined),
});

export type AuthRouteSearch = z.infer<typeof AuthSearchSchema>;
