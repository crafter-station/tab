import type { ZodType } from "zod";
import { formatValidationIssues } from "./responses.ts";

type JsonRequest = {
  json(): Promise<unknown>;
};

type ReadJsonRequestResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly message: string };

export async function readJsonRequest<T>(
  request: JsonRequest,
  schema: ZodType<T>,
): Promise<ReadJsonRequestResult<T>> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return { ok: false, message: "Request body must be valid JSON." };
  }

  const result = schema.safeParse(payload);
  if (!result.success) {
    return {
      ok: false,
      message: formatValidationIssues(result.error.issues),
    };
  }

  return { ok: true, data: result.data };
}
