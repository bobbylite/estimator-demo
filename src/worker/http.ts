import type { ZodType } from "zod";

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export async function readJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let data: unknown;
  try {
    data = await request.json();
  } catch {
    throw new HttpError(400, "Expected JSON.");
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request.");
  }
  return parsed.data;
}

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}
